/**
 * packing.html のエントリポイント。
 *
 * 起動順は schedule.js と同じ「鍵の確認 → publish-ui の組み立て → load()」。
 * publish-ui を load() の後ろに置くと、リモートが壊れた端末では公開ボタンも
 * トークン設定も DOM に現れず、ブラウザから直す手段がゼロになる（設計書 §13）。
 *
 * packing.json は**最初の公開までリポジトリに存在しない**。404 を「まだ無い」として
 * 空のリストで始める ── 暗号化した初期ファイルを外から用意する手段が無いため
 * （合言葉を持つ人が画面で項目を足して公開した瞬間に、最初のファイルができる）。
 */

import { injectSprite, icon } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { el, escapeHtml } from "./dom.js";
import { createStore } from "./store.js";
import { createSync, DEFAULT_CONFIG } from "./sync.js";
import { createPublishUI } from "./publish-ui.js";
import { classifyLoadError, DataFetchError, DataParseError } from "./load-error.js";
import { hasKey, loadCodec, clearKey } from "./auth.js";
import { DecryptError } from "./crypto.js";
import { DataError } from "./data-error.js";
import { validatePacking } from "./packing-validate.js";
import {
  emptyPacking,
  nextGroupId,
  nextItemId,
  withGroup,
  withoutGroup,
  withItem,
  withoutItem,
  moveItem,
  moveGroup,
} from "./packing-data.js";
import { renderProgress, renderTable } from "./packing-render.js";
import { attachDrag } from "./packing-drag.js";

/** どのデータの話かを 1 か所に持つ。sync / publish-ui / load-error の 3 つが読む。 */
const SUBJECT = { noun: "持ち物リスト", path: "assets/data/packing.json" };

const state = {
  data: null,
  editing: false,
};

const els = {
  table: document.getElementById("pk-table"),
  progress: document.getElementById("pk-progress"),
  editToggle: document.getElementById("pk-edit-toggle"),
  addGroup: document.getElementById("pk-add-group"),
  pubControls: document.getElementById("pub-controls"),
  pubPanel: document.getElementById("pub-panel"),
  pubStatus: document.getElementById("pub-status"),
  syncbar: document.getElementById("syncbar"),
};

let publishUI = null;
let sync = null;
let drag = null;

/**
 * 描き直したあとにフォーカスを戻す。
 *
 * renderTable() は毎回 mount.replaceChildren() で全ノードを作り直すので、
 * 押した瞬間のボタンや、入力していた最中の欄はもう文書にいない
 * （detach された要素への focus() は何も起きず、フォーカスは <body> へ落ちる）。
 * ↑↓ ボタンはドラッグを使えない人のための唯一の並べ替え手段（設計書 §7.3）で、
 * 押すたびにフォーカスを失うと、次の 1 手のために毎回タブの先頭からやり直す
 * ことになる ── 一番助けが要る操作をこのページ自身が壊すことになる。
 *
 * packing-render.js が付ける data-focus-key は id から作ってあるので、
 * 並べ替えで位置が変わっても同じキーで引ける。見つからなければ
 * （行そのものを削除した、など）publish-ui.js の focusFallback と同じ考え方で、
 * 必ず存在するツールバーの先頭（編集トグル）へ逃がす。
 */
function restoreFocus(focusKey) {
  if (!focusKey) return;
  const next = els.table.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
  (next ?? els.editToggle)?.focus();
}

/**
 * 描き直す。ドラッグは表を作り直すたびに配線し直す ──
 * 前の表の要素はもう文書にいないので、リスナも一緒に捨てる。
 *
 * @param {string|null} [focusKeyOverride] 押した瞬間のボタンではなく、
 *   別の要素へフォーカスを送りたいときに渡す（例: 項目を追加した直後、
 *   新しい行の名前欄へ）。渡さなければ、いつもどおり document.activeElement
 *   の focusKey を使う。
 */
function draw(focusKeyOverride) {
  const focusKey = focusKeyOverride ?? document.activeElement?.dataset?.focusKey ?? null;

  renderProgress({ mount: els.progress, data: state.data });
  renderTable({
    mount: els.table,
    data: state.data,
    editing: state.editing,
    handlers,
  });

  drag?.detach();
  drag = state.editing
    ? attachDrag({
        root: els.table,
        getData: () => state.data,
        commit: apply,
        // rebuildFromOrder() の内部不変条件が破れたときの逃げ道。ここで拾わないと
        // 例外は pointerup のリスナの外に出られず、コンソールにしか残らない
        // （apply() の try/catch は保存の失敗しか見ておらず、組み直し自体の失敗は
        // apply を呼ぶ前に起きるのでその外側になる）。draw() でドラッグ中に動いた
        // DOM を実際のデータへ戻し、そのあとで setNotice を上書きして知らせる
        // （safeDraw は成功時に setNotice(null) するので、順序を逆にしない）。
        onError: (error) => {
          console.error("packing: 並べ替えの反映に失敗しました", error);
          safeDraw("並べ替えの反映");
          setNotice(`並べ替えを反映できませんでした。${error?.message ?? String(error)}`);
        },
      })
    : null;

  restoreFocus(focusKey);
}

/* ── 再描画の予約 ────────────────────────────────────────
 *
 * 入力欄の change は blur の最中に発火する ── つまり、利用者がボタンを押した
 * mousedown の処理の**途中**で起きる。そこで表を replaceChildren すると:
 *
 * 1. 押しかけていたボタンが mouseup より前に文書から消え、click が発火しない。
 *    名前を打ってすぐ「項目を追加」を押しても項目は増えず、画面には何も出ない
 *    （2 度押せば動くので、余計に原因が分かりにくい）
 * 2. ブラウザが移そうとしていたフォーカス先も一緒に消えるので、
 *    document.activeElement は <body> になる。draw() がキーを拾えず、
 *    フォーカスは落ちたままになる
 *
 * どちらも「今のイベントの処理中に DOM を作り直している」ことが原因なので、
 * 描画を 1 tick 送って、click まで済んでから行う。そのとき activeElement は
 * 利用者が実際に移った先を指しているので、キーもそこから正しく拾える。
 *
 * microtask（queueMicrotask）では足りない ── blur → change は mousedown の
 * 既定動作の中で起きるため、microtask は mouseup より前に走ってしまう。
 *
 * 連続した変更（rename の直後に項目追加、など）は 1 回の描画にまとめる。
 * まとめないと、先に予約した描画が新しいフォーカス指定を上書きしてしまう。
 */
let drawTimer = null;
let drawContext = "";
let drawOverride = null;

function scheduleDraw(context, focusKeyOverride) {
  drawContext = context;
  // あとから来た指定を優先する。undefined で上書きして消さないこと
  if (focusKeyOverride) drawOverride = focusKeyOverride;
  if (drawTimer !== null) return;
  drawTimer = setTimeout(() => {
    drawTimer = null;
    const override = drawOverride;
    drawOverride = null;
    safeDraw(drawContext, override);
  }, 0);
}

/**
 * 再描画の失敗を画面に出す（schedule.js の safeDraw と同じ役割）。
 * ここで落ちると、表が半分だけ描かれた状態で止まり、利用者には何も伝わらない。
 *
 * 予約済みの描画があれば取り消してから描く。残すと、この呼び出しのあとに
 * 予約分が走り、成功時の setNotice(null) が直前に出した文言を消してしまう
 * （ドラッグの onError がまさにそれを出している）。
 */
function safeDraw(context, focusKeyOverride) {
  if (drawTimer !== null) {
    clearTimeout(drawTimer);
    drawTimer = null;
    drawOverride = null;
  }
  try {
    draw(focusKeyOverride);
    setNotice(null);
  } catch (error) {
    console.error(`packing: 再描画に失敗しました（${context}）`, error);
    setNotice(
      `表示の更新に失敗しました（${context}）。` +
        "直前の表示のまま止まっています。原因はブラウザのコンソールを確認してください。"
    );
  }
}

let noticeEl = null;
function setNotice(message) {
  if (!message && !noticeEl) return;
  if (!noticeEl) {
    noticeEl = document.createElement("p");
    noticeEl.className = "ferror";
    noticeEl.setAttribute("role", "alert");
    els.table.parentNode.insertBefore(noticeEl, els.table);
  }
  noticeEl.textContent = message ?? "";
  noticeEl.hidden = !message;
}

/**
 * 封筒の外側の updatedAt と中身が食い違っていたときの警告（outerStampMismatch）。
 * schedule.js の setStampNotice と同じ役割・同じ理由で別要素にする。
 *
 * setNotice とは別の要素にする。safeDraw は再描画に成功するたびに
 * setNotice(null) を呼ぶので、同じ要素を使うと編集モードの切り替えや
 * 最初の保存といった操作でこの警告が黙って消える。GCM の認証タグの外に
 * ある値の食い違いは操作の成否とは無関係な事実なので、次に公開して
 * 外側が正しい値に上書きされるまで出続けるべきもの ── ここでは message に
 * null 以外を渡す呼び出しが 1 か所（load 直後）しかなく、setStampNotice(null)
 * を呼ぶ場所を作っていないのはそのため（消す理由がまだ無い）。
 */
let stampNoticeEl = null;
function setStampNotice(message) {
  if (!message && !stampNoticeEl) return;
  if (!stampNoticeEl) {
    stampNoticeEl = document.createElement("p");
    stampNoticeEl.className = "ferror";
    stampNoticeEl.setAttribute("role", "status");
    els.table.parentNode.insertBefore(stampNoticeEl, els.table);
  }
  stampNoticeEl.textContent = message ?? "";
  stampNoticeEl.hidden = !message;
}

/**
 * 変更を保存して描き直す。
 *
 * 順序が意味を持つ: 検査 → 下書きへ書く → 反映。saveLocal が投げたら
 * state も画面も動かない ── 保存できていないのに画面だけ新しい、という
 * 食い違いを作らない（schedule.js の commit と同じ）。
 *
 * validatePacking(next) を先に呼ぶのは、id の重複検出の網としてではない
 * （event-editor.js の applyChange とは違い、このファイルは 1 件ずつの検査を
 * 経由しないので、そもそも「網の下」に何も無い）。sync.saveLocal も
 * cfg.validate（= validatePacking）を内部で呼ぶので、検査そのものは
 * ここが無くても saveLocal が必ず行う ── ここで先に呼ぶのは、保存の失敗を
 * 「検査に落ちた」と「保存領域に書けなかった」で区別しやすくしておく、
 * という明示のための呼び出しであり、実際の関所は saveLocal 側にある。
 *
 * @param {object} next 保存するデータ
 * @param {string|null} [focusKeyOverride] draw() へそのまま渡す。項目・区分の
 *   追加のように「押したボタンではなく新しく生まれた入力欄へフォーカスを送りたい」
 *   呼び出しだけが指定する（設計書 §7.3「追加後は入力欄にフォーカス」）。
 */
function apply(next, focusKeyOverride) {
  try {
    validatePacking(next);
    state.data = sync.saveLocal(next);
  } catch (error) {
    console.error("packing: 保存できませんでした", error);
    setNotice(
      error instanceof DataError
        ? `この内容では保存できません。${error.message}`
        : `保存に失敗しました。${error?.message ?? String(error)}`
    );
    return;
  }
  publishUI?.refreshDirty();
  // 即時ではなく予約する。apply() は入力欄の change からも呼ばれ、
  // そこは利用者が押したボタンの mousedown の処理中だから（scheduleDraw 参照）
  scheduleDraw("持ち物リストの保存", focusKeyOverride);
}

const handlers = {
  onToggle(itemId, member, checked) {
    const item = state.data.groups.flatMap((g) => g.items).find((i) => i.id === itemId);
    if (!item) return;
    apply(withItem(state.data, null, { ...item, [member]: checked }));
  },
  onRenameItem(itemId, patch) {
    const item = state.data.groups.flatMap((g) => g.items).find((i) => i.id === itemId);
    if (!item) return;
    apply(withItem(state.data, null, { ...item, ...patch }));
  },
  /**
   * 入れる場所を決める。onRenameItem に相乗りさせない ── あちらは
   * 名前とメモのための口で、{ where } を混ぜると呼び名と中身が食い違う。
   * 空文字は「未設定に戻す」で、検証もそれを通す（packing-validate.js）。
   */
  onSetPlace(itemId, where) {
    const item = state.data.groups.flatMap((g) => g.items).find((i) => i.id === itemId);
    if (!item) return;
    apply(withItem(state.data, null, { ...item, where }));
  },
  onRenameGroup(groupId, patch) {
    const group = state.data.groups.find((g) => g.id === groupId);
    if (!group) return;
    apply(withGroup(state.data, { ...group, ...patch }));
  },
  onAddItem(groupId) {
    // id は withItem() に渡す前に採番する ── 追加後にどの行が新顔かを
    // apply() へ伝える手段が、他に無い（設計書 §7.3「追加後は入力欄にフォーカス」）。
    const id = nextItemId(state.data.groups);
    apply(
      withItem(state.data, groupId, {
        id,
        name: "新しい項目",
        note: "",
        a: false,
        b: false,
      }),
      `item:${id}:name`
    );
  },
  onDeleteItem: (itemId) => apply(withoutItem(state.data, itemId)),
  onDeleteGroup: (groupId) => apply(withoutGroup(state.data, groupId)),
  onMoveItem: (itemId, delta) => apply(moveItem(state.data, itemId, delta)),
  onMoveGroup: (groupId, delta) => apply(moveGroup(state.data, groupId, delta)),
};

function buildToolbar() {
  const label = el("span", null, "リストを編集");
  els.editToggle.innerHTML = icon("i-edit", "ico--sm");
  els.editToggle.appendChild(label);
  els.editToggle.addEventListener("click", () => {
    state.editing = !state.editing;
    els.editToggle.setAttribute("aria-pressed", String(state.editing));
    label.textContent = state.editing ? "編集を終える" : "リストを編集";
    els.addGroup.hidden = !state.editing;
    safeDraw("編集モードの切り替え");
  });

  els.addGroup.innerHTML = icon("i-plus", "ico--sm");
  els.addGroup.appendChild(el("span", null, "区分を追加"));
  els.addGroup.addEventListener("click", () => {
    // このボタンは #pk-table の外（ツールバー）にいて draw() では作り直されない。
    // つまり document.activeElement を控える通常の経路では何も起きず
    // （このボタン自身に data-focus-key が無いので restoreFocus が素通りする）、
    // クリック後もブラウザは既定でこのボタンにフォーカスを残す。
    // それでは新しく増えた区分（表の最後尾）へは、既存の区分をすべて
    // タブで飛び越さないと辿り着けない ── onAddItem と同じ理由で、
    // id を先に採番し、明示的に新しい区分名の入力欄へ送る。
    const id = nextGroupId(state.data.groups);
    apply(
      withGroup(state.data, {
        id,
        name: "新しい区分",
        icon: "i-note",
        items: [],
      }),
      `group:${id}:name`
    );
  });

  els.editToggle.disabled = false;
  els.addGroup.disabled = false;
  els.addGroup.hidden = true;
}

function showLoadError(error) {
  const { message } = classifyLoadError(error, SUBJECT);
  els.table.innerHTML = `<p class="ferror ferror--block">${escapeHtml(message)}</p>`;
}

async function main() {
  injectSprite();
  renderNav(document.getElementById("nav"), "packing");

  const store = createStore();

  // 鍵が無ければ復号できない。合言葉を入れてもらうため入口へ戻す。
  // hasKey() ではなく loadCodec() の結果で判断する理由は schedule.js のコメント参照
  // （形は正しいが base64 として壊れた鍵は hasKey を通り、loadCodec で null になる）。
  const codec = hasKey(store) ? await loadCodec(store) : null;
  if (codec === null) {
    clearKey(store);
    location.replace("index.html");
    return;
  }

  // **6 つを揃えて渡す。** 一部だけだと旅程の下書き（tp:events）が
  // 持ち物データで上書きされる（設計書 §13、sync.js の DEFAULT_CONFIG のコメント）
  sync = createSync({
    store,
    config: {
      ...DEFAULT_CONFIG,
      path: SUBJECT.path,
      draftKey: "packing",
      baseKey: "packing-base",
      validate: validatePacking,
      commitMessage: (data) => {
        const count = data.groups.reduce((n, g) => n + g.items.length, 0);
        return `Update packing list from the browser (${count} item${count === 1 ? "" : "s"})`;
      },
      noun: SUBJECT.noun,
      codec,
    },
  });

  publishUI = createPublishUI({
    els: {
      controls: els.pubControls,
      panel: els.pubPanel,
      status: els.pubStatus,
      bar: els.syncbar,
    },
    store,
    sync,
    getData: () => state.data,
    content: { validate: validatePacking, noun: SUBJECT.noun },
    onAdopt: (data) => {
      state.data = data;
      safeDraw("リモートの取り込み");
    },
  });

  let loaded;
  try {
    loaded = await sync.load();
  } catch (error) {
    // 404 は「取れなかった」ではなく「まだ作られていない」。空のリストで始める。
    // ここを取り違えると、最初の 1 人が永久にページを開けない
    if (error?.status === 404) {
      state.data = emptyPacking();
      buildToolbar();
      publishUI.start("use-local");
      draw();
      return;
    }

    // リモートが壊れていても、手元に正しい下書きがあれば公開で直せる
    // （schedule.js の同じ catch と同じ理由。設計書 §6.5）
    const draft = sync.readDraft();
    if (draft) {
      state.data = draft;
      publishUI.refreshDirty();
    }

    if (error instanceof DataError) throw error;
    if (error instanceof DecryptError) throw error;
    if (error?.cause instanceof SyntaxError) throw new DataParseError(error.message, error.cause);
    throw new DataFetchError(error?.message ?? String(error));
  }

  state.data = loaded.data;

  if (loaded.outerStampMismatch) {
    // 封筒の外側は認証されないので、改竄も破損も GCM は気付かない。
    // 内側を正として表示しているが、黙って直すと誰も気付かないまま進む
    // （schedule.js の同じ分岐と同じ理由。設計書 §6.2）。
    // 「公開し直すと揃います」と言い切らない理由は sync.js の
    // assertRemoteNotAhead のコメント参照 ── 常に揃うとは限らない
    setStampNotice(
      "リモートのファイルの更新時刻が中身と食い違っています。" +
        "中身の時刻を正として表示しています。公開し直すと揃うことがあります。"
    );
  }

  buildToolbar();
  publishUI.start(loaded.source);
  draw();
}

// initReveal() は必ず走らせる。.reveal は opacity: 0 で待機しているので、
// 飛ばすとページが真っ白になる（エラーそのものも読み取れなくなる）
main()
  .catch((error) => {
    console.error(error);
    showLoadError(error);
  })
  .finally(() => {
    initReveal();
  });
