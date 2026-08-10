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
import { classifyLoadError, toLoadError } from "./load-error.js";
import { hasKey, loadCodec, clearKey } from "./auth.js";
import { DataError } from "./data-error.js";
import { createNotices, createDrawLoop } from "./page-notice.js";
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
import { itemFocusKey, groupFocusKey } from "./focus-key.js";

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

/**
 * 通知は 2 つとも page-notice.js が作る（設計書 §13 の重複の抽出）。
 * 表本体（els.table）の直前に差し込む。
 */
const { setNotice, setStampNotice } = createNotices(els.table);

/**
 * 即時（safeDraw）と予約（scheduleDraw）の 2 つの口。予約が要る理由と、
 * 予約の取り消しが safeDraw の内側にある理由は page-notice.js を参照
 * （設計書 §13。node --test では捕まえられない不具合の修正なので、
 * あの記述を消さないこと）。
 */
const { safeDraw, scheduleDraw } = createDrawLoop({ page: "packing", draw, setNotice });

/**
 * 変更を保存して描き直す。
 *
 * 順序が意味を持つ: 検査 → 下書きへ書く → 反映。saveLocal が投げても state は
 * 動かないが、**画面はすでに動いていることがある**（チェックボックスなど、
 * ブラウザ自身が先に見た目を変えてしまう操作があるため）。catch では必ず
 * safeDraw() で描き直し、画面を state（＝保存に失敗する前の値）へ揃え直す ──
 * ここを飛ばすと、チェックは入ったまま・進捗は動かない・保存もされていない、
 * という食い違った見た目が次の再描画まで残り続ける（schedule.js の commit と同じ）。
 *
 * **safeDraw() は必ず setNotice() より先に呼ぶ。** safeDraw() は成功時に
 * setNotice(null) を呼ぶ副作用があるので、逆順にすると直後の setNotice が
 * 書いたエラー文を safeDraw が消してしまう。
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
    // 画面を state に揃え直してから知らせる。順序を逆にしないこと（上のコメント参照）
    safeDraw("保存の失敗による表示の巻き戻し");
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
      itemFocusKey(id, "name")
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
      groupFocusKey(id, "name")
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

    throw toLoadError(error);
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
