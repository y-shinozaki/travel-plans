import { injectSprite } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { renderCalendar } from "./calendar.js";
import { CAT_META } from "./categories.js";
import { createMap } from "./map.js";
import { createSheet, renderEventDetail } from "./sheet.js";
import { escapeHtml } from "./dom.js";
import { validateEvents, EventDataError } from "./validate.js";

/** HTTP エラー・通信断。取りに行けなかった、という種類の失敗。 */
class DataFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataFetchError";
  }
}

/** 取れたが JSON として読めなかった。404 が HTML で返る場合もここに来る。 */
class DataParseError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "DataParseError";
  }
}

const state = {
  days: [],
  events: [],
  viewStart: 6,
  viewEnd: 22,
  catFilter: null,
  onSelect: null,
};

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
};

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
 * 失敗の種類ごとに違う案内を出す。
 *
 * 以前は 1 つの文言ですべてを説明しようとしていた。だが JSON の書き間違いや
 * データ内容の不備に対して「通信状況を確認して再読み込み」は端的に嘘で、
 * 何度再読み込みしても直らないものを再読み込みさせることになる。
 * 直し方が違う失敗は、違う文言で言う。
 */
function loadErrorMessage(error) {
  if (error instanceof EventDataError) {
    return (
      "旅程データ（assets/data/events.json）の内容に問題があります。\n" +
      "再読み込みでは直りません。下記を直してから読み込み直してください。\n\n" +
      error.message
    );
  }
  if (error instanceof DataParseError) {
    return (
      "旅程データ（assets/data/events.json）を JSON として読めませんでした。\n" +
      "ファイルの書式（末尾のカンマ、閉じ括弧、クォート）を確認してください。\n" +
      "サーバーが JSON の代わりに HTML のエラーページを返している場合も" +
      "これになります。\n\n" +
      error.message
    );
  }
  if (error instanceof DataFetchError) {
    return (
      "旅程データ（assets/data/events.json）を取得できませんでした。\n" +
      "通信状況を確認してページを再読み込みするか、" +
      "手元で開いている場合は file:// ではなくローカルサーバー" +
      "（python3 -m http.server）経由でアクセスしてください。\n\n" +
      error.message
    );
  }
  // データは読めたが、描画・地図の初期化などで落ちたケース
  return (
    "旅程の表示中に想定外のエラーが発生しました。\n" +
    "データの読み込み自体は完了している可能性があります。" +
    "詳細はブラウザのコンソールを確認してください。\n\n" +
    `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`
  );
}

function showLoadError(error) {
  els.cal.innerHTML = `<p class="ferror ferror--block">${escapeHtml(loadErrorMessage(error))}</p>`;
}

async function main() {
  injectSprite();

  const sheet = createSheet({
    root: document.getElementById("sheet"),
    overlay: document.getElementById("sheet-overlay"),
    titleEl: document.getElementById("sheet-title"),
    bodyEl: document.getElementById("sheet-body"),
    footEl: document.getElementById("sheet-foot"),
    closeBtn: document.getElementById("sheet-close"),
  });

  // Phase B でここに編集ボタンが増える。
  //
  // renderEventDetail(...) は sheet.open() の引数として評価されるので、
  // ここで落ちると sheet.open() 自体が呼ばれない ── 画面は微動だにせず、
  // 利用者には「押し損ねた」のか「壊れた」のかが区別できない。
  // 本文の生成に失敗したときは、シートは必ず開いてその中で失敗を伝える。
  const openDetail = (ev) => {
    let body;
    try {
      body = renderEventDetail(ev, state.days);
    } catch (error) {
      console.error(
        `schedule: 詳細の生成に失敗しました（${ev?.id ?? "id なし"} / ${ev?.title ?? ""}）`,
        error
      );
      sheet.open(
        "詳細を表示できません",
        `<p class="ferror ferror--block">${escapeHtml(
          `この予定（${ev?.id ?? "id なし"}）の詳細を組み立てられませんでした。\n` +
            "旅程データが壊れている可能性があります。\n\n" +
            `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`
        )}</p>`
      );
      return;
    }
    sheet.open("予定の詳細", body);
  };
  state.onSelect = openDetail;

  renderNav(document.getElementById("nav"), "schedule");

  let response;
  try {
    response = await fetch("assets/data/events.json");
  } catch (error) {
    // fetch が reject するのは通信断・CORS・file:// のとき（HTTP エラーでは reject しない）
    throw new DataFetchError(`events.json へ到達できません: ${error.message}`);
  }
  if (!response.ok) {
    throw new DataFetchError(`events.json の取得に失敗しました: HTTP ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new DataParseError(`events.json を JSON として解釈できません: ${error.message}`, error);
  }

  // 描画より前に一度だけ検査する。ここを通った後のコードは
  // 「days の添字は有効」「座標は有限」を前提にしてよい
  validateEvents(data);
  state.days = data.days;
  state.events = data.events;

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
