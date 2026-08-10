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
 * 描き直す。ドラッグは表を作り直すたびに配線し直す ──
 * 前の表の要素はもう文書にいないので、リスナも一緒に捨てる。
 */
function draw() {
  renderProgress({ mount: els.progress, data: state.data });
  renderTable({
    mount: els.table,
    data: state.data,
    editing: state.editing,
    handlers,
  });

  drag?.detach();
  drag = state.editing
    ? attachDrag({ root: els.table, getData: () => state.data, commit: apply })
    : null;
}

/**
 * 再描画の失敗を画面に出す（schedule.js の safeDraw と同じ役割）。
 * ここで落ちると、表が半分だけ描かれた状態で止まり、利用者には何も伝わらない。
 */
function safeDraw(context) {
  try {
    draw();
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
 * 変更を保存して描き直す。
 *
 * 順序が意味を持つ: 検査 → 下書きへ書く → 反映。saveLocal が投げたら
 * state も画面も動かない ── 保存できていないのに画面だけ新しい、という
 * 食い違いを作らない（schedule.js の commit と同じ）。
 *
 * 配列全体を validatePacking に通すのは、1 件ずつの検査では id の重複を
 * 検出できないため（event-editor.js の applyChange と同じ理由）。
 */
function apply(next) {
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
  safeDraw("持ち物リストの保存");
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
  onRenameGroup(groupId, patch) {
    const group = state.data.groups.find((g) => g.id === groupId);
    if (!group) return;
    apply(withGroup(state.data, { ...group, ...patch }));
  },
  onAddItem(groupId) {
    apply(
      withItem(state.data, groupId, {
        id: nextItemId(state.data.groups),
        name: "新しい項目",
        note: "",
        a: false,
        b: false,
      })
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
  els.addGroup.addEventListener("click", () =>
    apply(
      withGroup(state.data, {
        id: nextGroupId(state.data.groups),
        name: "新しい区分",
        icon: "i-note",
        items: [],
      })
    )
  );

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
