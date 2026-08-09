import { injectSprite } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { renderCalendar } from "./calendar.js";
import { CAT_META } from "./categories.js";
import { createMap } from "./map.js";
import { createSheet, renderEventDetail } from "./sheet.js";

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
      draw();
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
 * 失敗の理由は 1 つではない。GitHub Pages なら 404 や通信断、
 * 手元なら file:// で開いている、JSON の書き間違いもある。
 * どれか 1 つだけを名指しすると残りの場合に誤った案内になるので、
 * 両方を挙げる。
 */
function showLoadError() {
  els.cal.innerHTML =
    '<p class="ferror">旅程データ（assets/data/events.json）を読み込めませんでした。' +
    "通信状況を確認してページを再読み込みするか、" +
    "手元で開いている場合は file:// ではなくローカルサーバー" +
    "（python3 -m http.server）経由でアクセスしてください。</p>";
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

  // Phase B でここに編集ボタンが増える
  const openDetail = (ev) => sheet.open("予定の詳細", renderEventDetail(ev, state.days));
  state.onSelect = openDetail;

  renderNav(document.getElementById("nav"), "schedule");

  const response = await fetch("assets/data/events.json");
  if (!response.ok) {
    throw new Error(`events.json の取得に失敗しました: HTTP ${response.status}`);
  }
  const data = await response.json();
  state.days = data.days;
  state.events = data.events;

  fillHourOptions(els.viewStart, START_HOUR_CHOICES, state.viewStart);
  fillHourOptions(els.viewEnd, END_HOUR_CHOICES, state.viewEnd);

  els.viewStart.addEventListener("change", (e) => {
    state.viewStart = Number(e.target.value);
    draw();
  });
  els.viewEnd.addEventListener("change", (e) => {
    state.viewEnd = Number(e.target.value);
    draw();
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
    showLoadError();
  })
  .finally(() => {
    initReveal();
  });
