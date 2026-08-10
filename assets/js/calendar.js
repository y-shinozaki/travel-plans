import { timeLabel } from "./time.js";
import { expandEvents } from "./events.js";
import { assignLanes } from "./lanes.js";
import { icon } from "./icons.js";
import { iconOf } from "./categories.js";
import { el, makeSelectable } from "./dom.js";

/** 1時間あたりのピクセル高さ。tokens.css の --hour-h と一致させること。 */
export const HOUR_H = 44;

export function renderCalendar({ mount, days, events, viewStart, viewEnd, hiddenCats, onSelect }) {
  mount.innerHTML = "";
  // 列数は days の件数で決まる。CSS 側に repeat(6, ...) と焼き込むと
  // 日数が変わったときに黙って 2 行目へ折り返すため、データから供給する。
  mount.style.setProperty("--day-count", String(days.length));
  const segments = expandEvents(events, days.length);

  mount.appendChild(buildHeader(days));
  mount.appendChild(buildAllDayRow(days, segments, { hiddenCats, onSelect }));
  mount.appendChild(buildBody(days, segments, { viewStart, viewEnd, hiddenCats, onSelect }));
}

/**
 * カテゴリ絞り込みの判定。null は「すべて表示」。
 * 終日行と本体の 2 か所で使うため、条件はここ 1 か所にだけ書く
 * （同じ式を 2 か所に写すと、片方だけ直された状態が見つからない）。
 */
/**
 * 隠すカテゴリの集合に入っていなければ描く。
 *
 * 2026-08-10 に「1 つだけ表示」から「選んだものを隠す」へ変えた。
 * 宿泊は毎日ある終日イベントで、既定で隠しておきたいという要望が起点
 * （schedule.js の HIDDEN_BY_DEFAULT）。
 *
 * hiddenCats を省略した呼び出しは「何も隠さない」= 全部描く。
 */
const isVisible = (seg, hiddenCats) => !hiddenCats?.has(seg.ref.cat);

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

function buildAllDayRow(days, segments, { hiddenCats, onSelect }) {
  const row = el("div", "cal__row");
  row.appendChild(el("div", "cal__allday-label", "All day"));
  const cells = el("div", "cal__days");

  days.forEach((_, dayIndex) => {
    const cell = el("div", "cal__allday-cell");
    const visible = segments.filter(
      (s) => s.allDay && s.day === dayIndex && isVisible(s, hiddenCats)
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

function buildBody(days, segments, { viewStart, viewEnd, hiddenCats, onSelect }) {
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
        isVisible(s, hiddenCats)
    );

    for (const seg of assignLanes(visible)) {
      column.appendChild(buildBlock(seg, { viewStart, viewEnd, order: order++, onSelect }));
    }
    columns.appendChild(column);
  });

  row.appendChild(columns);
  return row;
}

/** ブロックの最小高さ。これを下回ると帯として認識できない。 */
const MIN_BLOCK_H = 22;
/** 時刻ラベルを載せるのに必要な高さ。下回るとタイトルを優先して時刻を省く。 */
const TIME_LABEL_MIN_H = 36;
/** 隣のブロックとの間に空ける隙間（縦・横とも）。 */
const GAP = 2;

/**
 * セグメント 1 本の配置を求める。DOM に触らない純粋な計算。
 *
 * 表示範囲の外へはみ出す部分は from / to で切り落とす。
 * 高さには MIN_BLOCK_H の下限があるが、表示範囲の末尾では下限のほうを諦める
 * ── top を起点に伸ばすと列の下端（= totalHeight）を突き破るため、
 * 「列の高さ - top」を上回らないよう必ずクランプする。
 * showTime は「決めた高さ」に対する判定で、下限や上限クランプの後の値を見る。
 *
 * @returns {{top:number, height:number, leftPct:number, widthPct:number, showTime:boolean}}
 */
export function blockLayout({ start, end, viewStart, viewEnd, lane, laneCount }) {
  const from = Math.max(start, viewStart);
  const to = Math.min(end, viewEnd);
  const top = (from - viewStart) * HOUR_H;
  const totalHeight = (viewEnd - viewStart) * HOUR_H;
  const maxHeight = totalHeight - top;
  const height = Math.min(Math.max((to - from) * HOUR_H - GAP, MIN_BLOCK_H), maxHeight);
  const widthPct = 100 / laneCount;
  return {
    top,
    height,
    leftPct: lane * widthPct,
    widthPct,
    showTime: height >= TIME_LABEL_MIN_H,
  };
}

function buildBlock(seg, { viewStart, viewEnd, order, onSelect }) {
  const ev = seg.ref;
  const { top, height, leftPct, widthPct, showTime } = blockLayout({
    start: seg.start,
    end: seg.end,
    viewStart,
    viewEnd,
    lane: seg.lane,
    laneCount: seg.laneCount,
  });

  const block = el("div", `ev ${ev.cat}`);
  block.style.cssText = [
    `top:${top}px`,
    `height:${height}px`,
    `left:${leftPct}%`,
    `width:calc(${widthPct}% - ${GAP}px)`,
    `--d:${(order * 0.012).toFixed(3)}s`,
  ].join(";");

  const label = timeLabel(ev);
  const head = el("div", "ev__hd");
  head.innerHTML = icon(iconOf(ev));
  if (showTime) head.appendChild(el("span", "ev__t", label));
  block.appendChild(head);
  block.appendChild(el("div", "ev__n", ev.title));
  block.title = `${ev.title} / ${label}`;
  makeSelectable(block, ev, label, onSelect);
  return block;
}
