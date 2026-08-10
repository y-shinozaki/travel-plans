import { injectSprite, icon } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { renderCalendar } from "./calendar.js";
import { CAT_META } from "./categories.js";
import { createMap } from "./map.js";
import { createSheet } from "./sheet.js";
import { el, escapeHtml } from "./dom.js";
import { EventDataError } from "./validate.js";
import { createStore } from "./store.js";
import { createSync, DEFAULT_CONFIG } from "./sync.js";
import { createEventEditor } from "./event-editor.js";
import { createPublishUI } from "./publish-ui.js";
import { classifyLoadError, DataFetchError, DataParseError } from "./load-error.js";
import { hasKey, loadCodec, clearKey } from "./auth.js";

/**
 * data が正で、days / events はその一部を指すだけの控え。
 * 保存は data 全体（updatedAt を含む）に対して行うので、setData で
 * 必ず 3 つまとめて差し替える ── 片方だけ更新すると、画面に出ている旅程と
 * 保存される旅程が食い違う。
 */
const state = {
  data: null,
  days: [],
  events: [],
  viewStart: 6,
  viewEnd: 22,
  catFilter: null,
  onSelect: null,
};

function setData(data) {
  state.data = data;
  state.days = data.days;
  state.events = data.events;
}

/**
 * 時間帯セレクトに並べる選択肢の範囲。
 * state.viewStart / viewEnd は「初期選択値」であってこの範囲ではない。
 * 範囲を state から導くと、選択肢が 1 つしかないセレクトになってしまう。
 */
const START_HOUR_CHOICES = { min: 0, max: 12 };
const END_HOUR_CHOICES = { min: 13, max: 24 };

let mapView = null;

const els = {
  cal: document.getElementById("cal"),
  viewStart: document.getElementById("view-start"),
  viewEnd: document.getElementById("view-end"),
  catFilters: document.getElementById("cat-filters"),
  evEditToggle: document.getElementById("ev-edit-toggle"),
  evAdd: document.getElementById("ev-add"),
  pubControls: document.getElementById("pub-controls"),
  pubPanel: document.getElementById("pub-panel"),
  pubStatus: document.getElementById("pub-status"),
  syncbar: document.getElementById("syncbar"),
};

/**
 * 公開の導線。load() より前、renderNav の直後で組み立てる（main() 参照）。
 * リモートが壊れていても公開ボタンとトークン設定を画面に出すのが目的なので、
 * 旅程の読み込みを待たない。editor はさらに前に組み立てるため、参照は
 * ここではモジュールスコープの変数越しに後から差し込む。
 */
let publishUI = null;

function draw() {
  renderCalendar({
    mount: els.cal,
    days: state.days,
    events: state.events,
    viewStart: state.viewStart,
    viewEnd: state.viewEnd,
    catFilter: state.catFilter,
    onSelect: state.onSelect,
  });
  // 表示時間帯を変えただけのときは、地図側が自分で差分を見て何もしない
  mapView?.update(state.events, state.catFilter);
}

/**
 * 初回描画のあとの再描画。
 *
 * main() の try/catch が守るのは最初の draw() だけで、時間帯セレクトの change や
 * カテゴリチップの click から呼ばれる draw() は素通しだった。ここで落ちると
 * 画面は前回の描画を半分だけ残した状態で止まり、利用者には何も伝わらない。
 *
 * 読み込み失敗（showLoadError）とは別の文言にする。データは取れているのに
 * 操作に反応しなかった、という別の状況なので、「再読み込み」を勧めるのは誤り。
 * どの操作で、どの状態で失敗したかはコンソールへ出す。
 */
function safeDraw(context) {
  try {
    draw();
    setNotice(null);
  } catch (error) {
    console.error(
      `schedule: 再描画に失敗しました（${context}）`,
      { viewStart: state.viewStart, viewEnd: state.viewEnd, catFilter: state.catFilter },
      error
    );
    setNotice(
      `表示の更新に失敗しました（${context}）。` +
        "直前の表示のまま止まっています。原因はブラウザのコンソールを確認してください。"
    );
  }
}

/**
 * カレンダーの上に出す一行の通知。message が null なら消す。
 * カレンダー本体（els.cal）を潰さないので、再描画に失敗しても
 * 直前まで見えていた内容はそのまま残る。
 */
let noticeEl = null;
function setNotice(message) {
  if (!message && !noticeEl) return;
  if (!noticeEl) {
    noticeEl = document.createElement("p");
    noticeEl.className = "ferror";
    noticeEl.setAttribute("role", "alert");
    els.cal.parentNode.insertBefore(noticeEl, els.cal);
  }
  noticeEl.textContent = message ?? "";
  noticeEl.hidden = !message;
}

function fillHourOptions(select, { min, max }, selected) {
  select.innerHTML = "";
  for (let h = min; h <= max; h++) {
    const option = document.createElement("option");
    option.value = String(h);
    option.textContent = `${String(h).padStart(2, "0")}:00`;
    if (h === selected) option.selected = true;
    select.appendChild(option);
  }
}

function buildCategoryFilters() {
  const buttons = [];
  const makeChip = (label, value) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(state.catFilter === value));
    button.addEventListener("click", () => {
      state.catFilter = state.catFilter === value ? null : value;
      for (const b of buttons) {
        b.setAttribute("aria-pressed", String(b.dataset.value === (state.catFilter ?? "")));
      }
      safeDraw(`カテゴリ「${label}」`);
    });
    button.dataset.value = value ?? "";
    buttons.push(button);
    return button;
  };

  els.catFilters.appendChild(makeChip("すべて", null));
  for (const [key, meta] of Object.entries(CAT_META)) {
    els.catFilters.appendChild(makeChip(meta.label, key));
  }
}

/**
 * 編集ツールバー。
 *
 * 2 つのボタンは HTML 側で disabled にしてある。旅程が読めていない状態で
 * 押されると、編集の入口が「押しても何も起きないボタン」になってしまう
 * （データが無いので開けるフォームが無い）。読み込みが済んだここで初めて外す。
 *
 * ラベルは textContent、アイコンだけ innerHTML で入れる。HTML に
 * <use href="#i-edit"> を直書きすると、injectSprite() より前にパースされ、
 * WebKit が参照を解決し直さないことがある（sheet.js の閉じるボタンと同じ理由）。
 */
function buildEditorToolbar(editor) {
  const label = el("span", null, "予定を編集");
  els.evEditToggle.innerHTML = icon("i-edit", "ico--sm");
  els.evEditToggle.appendChild(label);
  els.evEditToggle.addEventListener("click", () => {
    const on = !editor.editMode();
    editor.setEditMode(on);
    els.evEditToggle.setAttribute("aria-pressed", String(on));
    label.textContent = on ? "編集を終える" : "予定を編集";
  });

  els.evAdd.innerHTML = icon("i-plus", "ico--sm");
  els.evAdd.appendChild(el("span", null, "予定を追加"));
  els.evAdd.addEventListener("click", () => editor.openNew());

  els.evEditToggle.disabled = false;
  els.evAdd.disabled = false;
}

/**
 * 失敗の種類ごとに違う案内を出す。分類と文言そのものは load-error.js に切り出した
 * （schedule.js はモジュール冒頭で document を触るため Node から import できず、
 * ここに置いたままでは node --test で検査できなかった）。
 */
function showLoadError(error) {
  const { message } = classifyLoadError(error);
  els.cal.innerHTML = `<p class="ferror ferror--block">${escapeHtml(message)}</p>`;
}

async function main() {
  injectSprite();

  const store = createStore();

  // 鍵が無ければ旅程は復号できない。合言葉を入れてもらうため入口へ戻す。
  // これは防御ではなく案内（設計書 §6.1）── 防御は鍵が無ければ復号できないこと。
  //
  // hasKey() ではなく loadCodec() の結果で判断する。**この 2 つは一致しない。**
  // hasKey() が見るのは形（`salt.iter.key` の 3 つが揃っているか）だけで、
  // salt や key が base64 として壊れていても true を返す。その場合
  // loadCodec() は null を返すので、hasKey() で通してしまうと codec が null のまま
  // createSync へ流れ込み、最初に codec.encode / decode を呼んだところで
  // 「Cannot read properties of null」が無関係な場所から出る ──
  // 原因が壊れた tp:key であることは画面からもコンソールからも読み取れない。
  //
  // 壊れていた鍵素材はここで捨てる。残しておくと戻った先の index.html が
  // 「鍵は設定済み」と判断して合言葉の欄を出さず、入口が塞がったまま堂々巡りになる。
  const codec = hasKey(store) ? await loadCodec(store) : null;
  if (codec === null) {
    clearKey(store);
    location.replace("index.html");
    return;
  }

  const sync = createSync({ store, config: { ...DEFAULT_CONFIG, codec } });

  // シートと editor は同じ本文要素を見る。editor は sheet.open() が入れた
  // HTML から入力欄を引き直すので、別の要素を渡すと黙って何も見つからなくなる。
  // 引き直しを 1 か所にして、その取り違えを起こせなくしてある。
  const sheetBodyEl = document.getElementById("sheet-body");

  const sheet = createSheet({
    root: document.getElementById("sheet"),
    overlay: document.getElementById("sheet-overlay"),
    titleEl: document.getElementById("sheet-title"),
    bodyEl: sheetBodyEl,
    footEl: document.getElementById("sheet-foot"),
    closeBtn: document.getElementById("sheet-close"),
  });

  const editor = createEventEditor({
    sheet,
    bodyEl: sheetBodyEl,
    getData: () => state.data,
    // 保存の順序が意味を持つ: 検証（editor 側）→ 下書きへ書く → 反映。
    // saveLocal が投げたら state も画面も動かない ── 保存できていないのに
    // 画面だけ新しい、という食い違いを作らない。
    // 再描画の失敗は safeDraw が拾う（保存は済んでいるので、ここで
    // 例外にすると editor が「保存に失敗しました」と嘘をつく）。
    commit: (next) => {
      setData(sync.saveLocal(next));
      // 保存できた時点で「未公開の変更」が生まれる。有無の判断は publish-ui が
      // ストアに聞き直すので、ここでは「動いた」ことだけ伝える。
      // saveLocal が投げたらここには来ない（保存できていないのに公開を促さない）
      publishUI?.refreshDirty();
      safeDraw("予定の保存");
    },
    fallbackFocus: els.evAdd,
  });
  state.onSelect = editor.select;

  renderNav(document.getElementById("nav"), "schedule");

  // 公開の導線は load() より前に組み立てる。
  // events.json の手編集は廃止したので（設計書 §6.5）、リモートが壊れたときの
  // 復旧手段は「正しい下書きを持つ端末から公開し直す」1 本しかない。
  // load() のあとに組むと、リモートが壊れている端末では公開ボタンも
  // トークン設定も DOM に現れず、直す手段がゼロになる（設計書 §13）。
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
    onAdopt: (data) => {
      setData(data);
      safeDraw("リモートの取り込み");
    },
  });

  // 下書き（localStorage）とリモートを突き合わせて、見せるほうを受け取る。
  // 検証は sync.load() が両方に対して済ませている。
  // source（use-remote / remote-is-newer …）に応じた案内は Task 9 で出す。
  let loaded;
  try {
    loaded = await sync.load();
  } catch (error) {
    // sync.load() の失敗は「取りに行けなかった」「JSON として読めなかった」
    // 「中身が旅程の形になっていない」「復号できなかった」の 4 種類で、
    // 直し方がそれぞれ違う。案内を出し分けられるよう、ここで種別を付け直す
    // （JSON の解釈失敗だけは cause が SyntaxError になる）。
    if (error instanceof EventDataError) throw error;
    if (error?.name === "DecryptError") throw error;
    if (error?.cause instanceof SyntaxError) throw new DataParseError(error.message, error.cause);
    throw new DataFetchError(error?.message ?? String(error));
  }
  setData(loaded.data);

  if (loaded.outerStampMismatch) {
    // 封筒の外側は認証されないので、改竄も破損も GCM は気付かない。
    // 内側を正として表示しているが、黙って直すと誰も気付かないまま進む
    setNotice(
      "リモートのファイルの更新時刻が中身と食い違っています。" +
        "中身の時刻を正として表示しています。公開し直すと揃います。"
    );
  }

  fillHourOptions(els.viewStart, START_HOUR_CHOICES, state.viewStart);
  fillHourOptions(els.viewEnd, END_HOUR_CHOICES, state.viewEnd);

  els.viewStart.addEventListener("change", (e) => {
    state.viewStart = Number(e.target.value);
    safeDraw("表示開始時刻の変更");
  });
  els.viewEnd.addEventListener("change", (e) => {
    state.viewEnd = Number(e.target.value);
    safeDraw("表示終了時刻の変更");
  });

  mapView = createMap({
    mapMount: document.getElementById("leaflet-map"),
    listMount: document.getElementById("loclist"),
    days: state.days,
    onSelect: state.onSelect,
  });

  buildCategoryFilters();
  buildEditorToolbar(editor);

  // source（use-remote / remote-is-newer / offline …）に応じた案内はここで出す。
  // publishUI 自体は load() より前、renderNav の直後で組み立て済み。
  publishUI.start(loaded.source);

  draw();
}

// initReveal() は必ず走らせる。.shead / .toolbar / .mapsec は opacity: 0 で
// 待機しているため、ここを飛ばすと画面が「見えないレイアウト 780px と
// エラー行 1 本」になってしまい、エラーそのものも読み取りづらい。
main()
  .catch((error) => {
    console.error(error);
    showLoadError(error);
  })
  .finally(() => {
    initReveal();
  });
