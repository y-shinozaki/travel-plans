import { timeLabel } from "./time.js";
import { expandEvents } from "./events.js";
import { assignLanes } from "./lanes.js";
import { icon } from "./icons.js";
import { iconOf } from "./categories.js";
import { el, makeSelectable } from "./dom.js";

/** 1時間あたりのピクセル高さ。tokens.css の --hour-h と一致させること。 */
export const HOUR_H = 44;

export function renderCalendar({ mount, days, events, viewStart, viewEnd, catFilter, onSelect }) {
  mount.innerHTML = "";
  // 列数は days の件数で決まる。CSS 側に repeat(6, ...) と焼き込むと
  // 日数が変わったときに黙って 2 行目へ折り返すため、データから供給する。
  mount.style.setProperty("--day-count", String(days.length));
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
      // アイコンだけ innerHTML（自前で組み立てた固定文字列）で、
      // イベント由来の文字列は textContent 経由でしか入れない
      pill.innerHTML = icon(iconOf(ev), "ico--sm");
      pill.appendChild(el("span", null, ev.title));
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
  head.innerHTML = icon(iconOf(ev));
  // 高さが足りないと時刻が読めないので、そのときは省いてタイトルを優先する
  if (height >= 36) head.appendChild(el("span", "ev__t", label));
  block.appendChild(head);
  block.appendChild(el("div", "ev__n", ev.title));
  block.title = `${ev.title} / ${label}`;
  makeSelectable(block, ev, label, onSelect);
  return block;
}
