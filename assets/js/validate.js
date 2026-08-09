/**
 * events.json の形を、描画が始まる前に一度だけ検査する。
 *
 * 描画側は「データは正しい」前提で書いてある。前提が破れたときの壊れ方は
 * 静かで、しかも場所ごとにばらばらだった:
 *
 * - startDay が日数を超えたイベントは expandEvents が 0 セグメントを返し、
 *   カレンダーから黙って消える（例外もログも出ない）
 * - lat / lng が NaN や Infinity だと L.marker / L.latLngBounds まで届き、
 *   地図が無言で壊れる（NaN != null は true なので hasCoords をすり抜ける）
 * - startDay / endDay が範囲外だと dayRangeLabel が素の TypeError を投げる。
 *   しかもクリックした瞬間まで表面化しない
 * - lat だけあって lng が無いイベントは「座標を持たない」と同じ扱いになり、
 *   意図的に地図へ出さないイベントと区別がつかない
 *
 * どれも「読み込み時にデータを見れば分かる」不備なので、ここで一度に、
 * どのイベントの何が悪いのかを名指しして止める。
 *
 * 見つけた不備は最初の 1 件で止めずに全部集める。1 件直しては再読み込み、を
 * 繰り返させないため（Phase B ではフォーム入力がこの検査に掛かる）。
 */

import { CAT_META } from "./categories.js";

/** データ内容の不備。通信・パース失敗とは呼び出し側で区別する。 */
export class EventDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventDataError";
  }
}

/** エラー文でイベントを名指しするためのラベル。id が無くても位置は示す。 */
function labelOf(ev, index) {
  const id = ev && typeof ev.id === "string" && ev.id ? ev.id : `events[${index}]`;
  const title = ev && typeof ev.title === "string" && ev.title ? `「${ev.title}」` : "";
  return `${id}${title}`;
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * エラー文に値を埋め込む。
 * JSON.stringify(Infinity) は "null" になるため、そのまま使うと
 * 「lat が有限の数値ではありません（null）」という嘘の説明になる。
 * 数値だけは String() で出す。
 */
const show = (v) => (typeof v === "number" ? String(v) : JSON.stringify(v));
/** null と undefined の両方を「値なし」として扱う（JSON では null が使われる）。 */
const isAbsent = (v) => v === null || v === undefined;

function checkDays(days, problems) {
  if (!Array.isArray(days)) {
    problems.push("days が配列ではありません");
    return false;
  }
  if (days.length === 0) {
    // 0 日だとカレンダーが grid-template-columns: repeat(0, 1fr) という
    // 不正な CSS になり、列が 1 本も出ないまま静かに崩れる
    problems.push("days が空です（最低 1 日必要です）");
    return false;
  }
  days.forEach((day, i) => {
    if (!isPlainObject(day)) {
      problems.push(`days[${i}] がオブジェクトではありません`);
      return;
    }
    for (const key of ["date", "dow"]) {
      if (typeof day[key] !== "string" || !day[key]) {
        problems.push(`days[${i}]: ${key} が空でない文字列ではありません`);
      }
    }
  });
  return true;
}

function checkDayIndex(value, name, dayCount, label, problems) {
  if (!Number.isInteger(value)) {
    problems.push(`${label}: ${name} が整数ではありません（${show(value)}）`);
    return false;
  }
  if (value < 0 || value >= dayCount) {
    problems.push(
      `${label}: ${name} が範囲外です（${value} / 有効な範囲は 0〜${dayCount - 1}）`
    );
    return false;
  }
  return true;
}

function checkCoords(ev, label, problems) {
  const latAbsent = isAbsent(ev.lat);
  const lngAbsent = isAbsent(ev.lng);
  if (latAbsent && lngAbsent) return;
  if (latAbsent !== lngAbsent) {
    // 片方だけだと hasCoords が false を返し「座標なし」と同じ扱いになる。
    // 意図的に地図へ出さないイベントと見分けが付かないので、書き間違いとして弾く
    problems.push(
      `${label}: lat / lng は両方書くか両方 null にしてください` +
        `（lat=${show(ev.lat)}, lng=${show(ev.lng)}）`
    );
    return;
  }
  for (const [name, value, limit] of [
    ["lat", ev.lat, 90],
    ["lng", ev.lng, 180],
  ]) {
    if (!isFiniteNumber(value)) {
      problems.push(`${label}: ${name} が有限の数値ではありません（${show(value)}）`);
    } else if (value < -limit || value > limit) {
      problems.push(`${label}: ${name} が範囲外です（${value} / ±${limit}）`);
    }
  }
}

function checkEvent(ev, index, dayCount, seenIds, problems) {
  const label = labelOf(ev, index);

  if (!isPlainObject(ev)) {
    problems.push(`events[${index}] がオブジェクトではありません`);
    return;
  }

  // id は地図の再描画判定（map.js の signatureOf）の鍵になる。
  // 重複すると別の地点が同じものとして扱われる
  if (typeof ev.id !== "string" || !ev.id) {
    problems.push(`events[${index}]: id が空でない文字列ではありません`);
  } else if (seenIds.has(ev.id)) {
    problems.push(`${label}: id が重複しています`);
  } else {
    seenIds.add(ev.id);
  }

  if (typeof ev.title !== "string") {
    problems.push(`${label}: title が文字列ではありません`);
  }

  if (!Object.hasOwn(CAT_META, ev.cat)) {
    problems.push(
      `${label}: 未知のカテゴリです（${show(ev.cat)} / ` +
        `有効な値は ${Object.keys(CAT_META).join(", ")}）`
    );
  }

  const startOk = checkDayIndex(ev.startDay, "startDay", dayCount, label, problems);
  const endOk = checkDayIndex(ev.endDay, "endDay", dayCount, label, problems);
  if (startOk && endOk && ev.endDay < ev.startDay) {
    problems.push(`${label}: endDay(${ev.endDay}) が startDay(${ev.startDay}) より前です`);
  }

  if (!ev.allDay) {
    for (const name of ["start", "end"]) {
      const value = ev[name];
      if (!isFiniteNumber(value)) {
        problems.push(
          `${label}: 終日でないイベントの ${name} が有限の数値ではありません` +
            `（${show(value)}）`
        );
      } else if (value < 0 || value > 24) {
        problems.push(`${label}: ${name} が 0〜24 の範囲外です（${value}）`);
      }
    }
    // start > end は日をまたぐイベントでは正しい（例: 22:10 発 → 翌 06:20 着）ので
    // ここでは弾かない。単日で start > end なら高さが負になるが、
    // buildBlock の下限クランプが吸収するため描画は破綻しない
  }

  checkCoords(ev, label, problems);
}

/**
 * 検査に通れば data をそのまま返す。通らなければ EventDataError を投げる。
 * 戻り値を使うことで、呼び出し側が「検査してから代入する」形に自然に書ける。
 */
export function validateEvents(data) {
  const problems = [];

  if (!isPlainObject(data)) {
    throw new EventDataError("events.json のトップレベルがオブジェクトではありません");
  }

  const daysOk = checkDays(data.days, problems);

  if (!Array.isArray(data.events)) {
    problems.push("events が配列ではありません");
  } else if (daysOk) {
    const seenIds = new Set();
    data.events.forEach((ev, i) => checkEvent(ev, i, data.days.length, seenIds, problems));
  }

  if (problems.length) {
    // 全部並べると数百行になりうるので先頭だけ出し、残りは件数で示す
    const shown = problems.slice(0, 10);
    const rest = problems.length - shown.length;
    const tail = rest > 0 ? `\n…ほか ${rest} 件` : "";
    throw new EventDataError(
      `旅程データに ${problems.length} 件の不備があります:\n- ${shown.join("\n- ")}${tail}`
    );
  }

  return data;
}
