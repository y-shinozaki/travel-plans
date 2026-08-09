import { injectSprite } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { renderCalendar, CAT_META } from "./calendar.js";
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
  mapView?.update(state.events, state.catFilter);
}

function fillHourOptions(select, min, max, selected) {
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
    els.cal.innerHTML =
      '<p class="ferror">旅程データを読み込めませんでした。ローカルサーバー経由で開いているか確認してください。</p>';
    return;
  }
  const data = await response.json();
  state.days = data.days;
  state.events = data.events;

  fillHourOptions(els.viewStart, 0, 12, state.viewStart);
  fillHourOptions(els.viewEnd, 13, 24, state.viewEnd);

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
  initReveal();
}

main();
