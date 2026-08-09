import { timeLabel } from "./time.js";
import { expandEvents } from "./events.js";
import { assignLanes } from "./lanes.js";
import { icon, CATEGORY_ICON } from "./icons.js";

/** 1時間あたりのピクセル高さ。tokens.css の --hour-h と一致させること。 */
export const HOUR_H = 44;

export const CAT_META = {
  "cat-move": { label: "移動" },
  "cat-sight": { label: "観光" },
  "cat-food": { label: "食事" },
  "cat-hotel": { label: "宿泊" },
  "cat-shop": { label: "買物" },
};

const iconOf = (ev) => ev.icon || CATEGORY_ICON[ev.cat];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * キーボードでも到達・実行できるようにする。
 * カレンダーのブロック／ピルは見た目上カード状で <button> の既定スタイルと
 * 相性が悪いため、role="button" + tabindex + keydown で最小限に済ませる。
 */
function makeSelectable(node, ev, label, onSelect) {
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", `${ev.title}、${label}`);
  node.addEventListener("click", () => onSelect(ev));
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      onSelect(ev);
    }
  });
}

export function renderCalendar({ mount, days, events, viewStart, viewEnd, catFilter, onSelect }) {
  mount.innerHTML = "";
  const segments = expandEvents(events, days.length);

  mount.appendChild(buildHeader(days));
  mount.appendChild(buildAllDayRow(days, segments, { catFilter, onSelect }));
  mount.appendChild(buildBody(days, segments, { viewStart, viewEnd, catFilter, onSelect }));
}

function buildHeader(days) {
  const row = el("div", "cal__row");
  row.appendChild(el("div", "cal__hdr-gutter"));
  const cells = el("div", "cal__days");
  for (const d of days) {
    const cell = el("div", "cal__dayhdr");
    const modifier =
      d.dow === "土" ? " cal__dow--sat" : d.dow === "日" ? " cal__dow--sun" : "";
    cell.appendChild(el("div", `cal__dow${modifier}`, d.dow));
    cell.appendChild(el("div", "cal__date", d.date));
    cells.appendChild(cell);
  }
  row.appendChild(cells);
  return row;
}

function buildAllDayRow(days, segments, { catFilter, onSelect }) {
  const row = el("div", "cal__row");
  row.appendChild(el("div", "cal__allday-label", "All day"));
  const cells = el("div", "cal__days");

  days.forEach((_, dayIndex) => {
    const cell = el("div", "cal__allday-cell");
    const visible = segments.filter(
      (s) => s.allDay && s.day === dayIndex && (!catFilter || s.ref.cat === catFilter)
    );
    for (const seg of visible) {
      const ev = seg.ref;
      const pill = el("div", `allday-pill ${ev.cat}`);
      pill.innerHTML = `${icon(iconOf(ev), "ico--sm")}<span>${ev.title}</span>`;
      makeSelectable(pill, ev, timeLabel(ev), onSelect);
      cell.appendChild(pill);
    }
    cells.appendChild(cell);
  });

  row.appendChild(cells);
  return row;
}

function buildBody(days, segments, { viewStart, viewEnd, catFilter, onSelect }) {
  const row = el("div", "cal__row");

  const gutter = el("div", "cal__gutter");
  for (let h = viewStart; h < viewEnd; h++) {
    gutter.appendChild(el("div", "cal__slot", `${String(h).padStart(2, "0")}:00`));
  }
  row.appendChild(gutter);

  const columns = el("div", "cal__days");
  const totalHeight = (viewEnd - viewStart) * HOUR_H;
  let order = 0;

  days.forEach((_, dayIndex) => {
    const column = el("div", "cal__col");
    column.style.height = `${totalHeight}px`;

    const visible = segments.filter(
      (s) =>
        !s.allDay &&
        s.day === dayIndex &&
        s.end > viewStart &&
        s.start < viewEnd &&
        (!catFilter || s.ref.cat === catFilter)
    );

    for (const seg of assignLanes(visible)) {
      column.appendChild(buildBlock(seg, { viewStart, viewEnd, order: order++, onSelect }));
    }
    columns.appendChild(column);
  });

  row.appendChild(columns);
  return row;
}

function buildBlock(seg, { viewStart, viewEnd, order, onSelect }) {
  const ev = seg.ref;
  const from = Math.max(seg.start, viewStart);
  const to = Math.min(seg.end, viewEnd);
  const top = (from - viewStart) * HOUR_H;
  // 22px の下限は表示範囲末尾では諦める。top を超えて伸ばすと列の下端を突き破るため、
  // 「列の高さ - top」を上回らないよう常にクランプする
  const totalHeight = (viewEnd - viewStart) * HOUR_H;
  const maxHeight = totalHeight - top;
  const height = Math.min(Math.max((to - from) * HOUR_H - 2, 22), maxHeight);
  const width = 100 / seg.laneCount;

  const block = el("div", `ev ${ev.cat}`);
  block.style.cssText = [
    `top:${top}px`,
    `height:${height}px`,
    `left:${seg.lane * width}%`,
    `width:calc(${width}% - 2px)`,
    `--d:${(order * 0.012).toFixed(3)}s`,
  ].join(";");

  const label = timeLabel(ev);
  const head = el("div", "ev__hd");
  // 高さが足りないと時刻が読めないので、そのときは省いてタイトルを優先する
  head.innerHTML =
    icon(iconOf(ev)) + (height >= 36 ? `<span class="ev__t">${label}</span>` : "");
  block.appendChild(head);
  block.appendChild(el("div", "ev__n", ev.title));
  block.title = `${ev.title} / ${label}`;
  makeSelectable(block, ev, label, onSelect);
  return block;
}
