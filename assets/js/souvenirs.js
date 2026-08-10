/**
 * souvenirs.html のエントリポイント。
 *
 * 起動順は packing.js と同じ「鍵の確認 → publish-ui の組み立て → load()」。
 * publish-ui を load() の後ろに置くと、リモートが壊れた端末では公開ボタンも
 * トークン設定も DOM に現れず、ブラウザから直す手段がゼロになる（設計書 §13）。
 *
 * souvenirs.json は**最初の公開までリポジトリに存在しない**。404 を「まだ無い」として
 * 空のリストで始める ── 暗号化した初期ファイルを外から用意する手段が無いため。
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
import { souvenirFocusKey } from "./focus-key.js";
import { validateSouvenirs } from "./souvenirs-validate.js";
import {
  emptySouvenirs,
  nextSouvenirId,
  withSouvenir,
  withoutSouvenir,
} from "./souvenirs-data.js";
import { renderProgress, renderTable } from "./souvenirs-render.js";

/** どのデータの話かを 1 か所に持つ。sync / publish-ui / load-error の 3 つが読む。 */
const SUBJECT = { noun: "お土産リスト", path: "assets/data/souvenirs.json" };

const state = {
  data: null,
  editing: false,
};

const els = {
  table: document.getElementById("sv-table"),
  progress: document.getElementById("sv-progress"),
  editToggle: document.getElementById("sv-edit-toggle"),
  add: document.getElementById("sv-add"),
  pubControls: document.getElementById("pub-controls"),
  pubPanel: document.getElementById("pub-panel"),
  pubStatus: document.getElementById("pub-status"),
  syncbar: document.getElementById("syncbar"),
};

let publishUI = null;
let sync = null;

/** 通知は 2 つとも page-notice.js が作る（設計書 §13）。 */
const { setNotice, setStampNotice } = createNotices(els.table);

/**
 * 描き直したあとにフォーカスを戻す。
 *
 * renderTable() は毎回 mount.replaceChildren() で全ノードを作り直すので、
 * 押した瞬間のボタンや、入力していた最中の欄はもう文書にいない。
 * キーは id から作ってあるので、行が増減しても同じキーで引ける。
 * 見つからなければ、必ず存在するツールバーの先頭（編集トグル）へ逃がす。
 */
function restoreFocus(focusKey) {
  if (!focusKey) return;
  const next = els.table.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
  (next ?? els.editToggle)?.focus();
}

function draw(focusKeyOverride) {
  const focusKey = focusKeyOverride ?? document.activeElement?.dataset?.focusKey ?? null;

  renderProgress({ mount: els.progress, data: state.data });
  renderTable({
    mount: els.table,
    data: state.data,
    editing: state.editing,
    handlers,
  });

  restoreFocus(focusKey);
}

/**
 * 即時（safeDraw）と予約（scheduleDraw）の 2 つの口。
 *
 * **予約が要る理由と、予約の取り消しが safeDraw の内側にある理由は
 * page-notice.js の createDrawLoop を読むこと**（設計書 §13）── 入力欄の
 * change は利用者が押したボタンの mousedown の処理中に発火するので、
 * そこで表を作り直すと click が発火せず「お土産を追加」が 1 度目で効かない。
 *
 * `const` は巻き上がらない。この行は `els` と `createNotices` の後ろ、
 * かつ最初に safeDraw が呼ばれる前になければ TDZ でページが真っ白になる。
 */
const { safeDraw, scheduleDraw } = createDrawLoop({ page: "souvenirs", draw, setNotice });

/**
 * 変更を保存して描き直す。
 *
 * 順序が意味を持つ: 検査 → 下書きへ書く → 反映。saveLocal が投げても state は
 * 動かないが、**画面はすでに動いていることがある**（チェックボックスなど、
 * ブラウザ自身が先に見た目を変えてしまう操作があるため）。catch では必ず
 * safeDraw() で描き直し、画面を state（＝保存に失敗する前の値）へ揃え直す ──
 * ここを飛ばすと、チェックは入ったまま・進捗は動かない・保存もされていない、
 * という食い違った見た目が次の再描画まで残り続ける。
 *
 * **safeDraw() は必ず setNotice() より先に呼ぶ。** safeDraw() は成功時に
 * setNotice(null) を呼ぶ副作用があるので、逆順にすると直後の setNotice が
 * 書いたエラー文を safeDraw が消してしまう。
 */
function apply(next, focusKeyOverride) {
  try {
    validateSouvenirs(next);
    state.data = sync.saveLocal(next);
  } catch (error) {
    console.error("souvenirs: 保存できませんでした", error);
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
  // 即時ではなく予約する。apply() は入力欄の change からも呼ばれるため
  scheduleDraw("お土産リストの保存", focusKeyOverride);
}

/** id で 1 行を引く。見つからなければ null。 */
const find = (id) => state.data.items.find((i) => i.id === id) ?? null;

const handlers = {
  onToggle(id, bought) {
    const item = find(id);
    if (!item) return;
    apply(withSouvenir(state.data, { ...item, bought }));
  },
  onEdit(id, patch) {
    const item = find(id);
    if (!item) return;
    // 併合であって置き換えではない。patch に無いキーを落とさない
    apply(withSouvenir(state.data, { ...item, ...patch }));
  },
  onDelete(id) {
    apply(withoutSouvenir(state.data, id));
  },
};

function buildToolbar() {
  const label = el("span", null, "リストを編集");
  els.editToggle.innerHTML = icon("i-edit", "ico--sm");
  els.editToggle.appendChild(label);
  els.editToggle.addEventListener("click", () => {
    state.editing = !state.editing;
    els.editToggle.setAttribute("aria-pressed", String(state.editing));
    label.textContent = state.editing ? "編集を終える" : "リストを編集";
    els.add.hidden = !state.editing;
    safeDraw("編集モードの切り替え");
  });

  els.add.innerHTML = icon("i-plus", "ico--sm");
  els.add.appendChild(el("span", null, "お土産を追加"));
  els.add.addEventListener("click", () => {
    // このボタンは #sv-table の外（ツールバー）にいて draw() では作り直されない。
    // 明示的に新しい行の「何を」の欄へ送らないと、既存の行を全部タブで
    // 飛び越さないと辿り着けない
    const id = nextSouvenirId(state.data.items);
    apply(
      withSouvenir(state.data, {
        id,
        name: "新しいお土産",
        recipient: "",
        shop: "",
        note: "",
        bought: false,
      }),
      souvenirFocusKey(id, "name")
    );
  });

  els.editToggle.disabled = false;
  els.add.disabled = false;
  els.add.hidden = true;
}

function showLoadError(error) {
  const { message } = classifyLoadError(error, SUBJECT);
  els.table.innerHTML = `<p class="ferror ferror--block">${escapeHtml(message)}</p>`;
}

async function main() {
  injectSprite();
  renderNav(document.getElementById("nav"), "souvenirs");

  const store = createStore();

  // 鍵が無ければ復号できない。合言葉を入れてもらうため入口へ戻す。
  // hasKey() ではなく loadCodec() の結果で判断する（形は正しいが base64 として
  // 壊れた鍵は hasKey を通り、loadCodec で null になる。schedule.js のコメント参照）
  const codec = hasKey(store) ? await loadCodec(store) : null;
  if (codec === null) {
    clearKey(store);
    location.replace("index.html");
    return;
  }

  // **6 つを揃えて渡す。** 一部だけだと旅程や持ち物の下書きが
  // お土産データで上書きされる（設計書 §13、sync.js の DEFAULT_CONFIG のコメント）
  sync = createSync({
    store,
    config: {
      ...DEFAULT_CONFIG,
      path: SUBJECT.path,
      draftKey: "souvenirs",
      baseKey: "souvenirs-base",
      validate: validateSouvenirs,
      commitMessage: (data) => {
        const count = data.items.length;
        return `Update souvenir list from the browser (${count} item${count === 1 ? "" : "s"})`;
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
    content: { validate: validateSouvenirs, noun: SUBJECT.noun },
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
      state.data = emptySouvenirs();
      buildToolbar();
      publishUI.start("use-local");
      draw();
      return;
    }

    // リモートが壊れていても、手元に正しい下書きがあれば公開で直せる（設計書 §6.5）
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
    // 内側を正として表示しているが、黙って直すと誰も気付かないまま進む（設計書 §6.2）
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
