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
import { DataError } from "./data-error.js";
import { isPlainObject } from "./plain-object.js";

/**
 * 旅程データ内容の不備。通信・パース失敗とは呼び出し側で区別する。
 * DataError を継承するのは、load-error.js が持ち物側の不備と同じ分類に
 * 落とせるようにするため（直し方が同じなので、文言も同じ枠でよい）。
 */
export class EventDataError extends DataError {
  constructor(message) {
    super(message);
    this.name = "EventDataError";
  }
}

/**
 * エラー文でイベントを名指しするためのラベル。
 * id が無いイベントは where（配列上の位置など、呼び出し側が知っている
 * 「どこの話か」）で代用する。
 *
 * **名指しを付けるのは validateEvents だけ。** validateEvent が返す不備は
 * 本文だけを持つ（下の Problem を参照）。以前は validateEvent 側が
 * `${label}: 本文` の形に継いでいたため、1 件しか扱わない編集フォームが
 * 文字列を切り直して名指しを落としていた ── タイトルや cat に ": " が
 * 入っただけで本文の頭が削れる、という壊れ方をした。
 */
function labelOf(ev, where) {
  const id = ev && typeof ev.id === "string" && ev.id ? ev.id : where;
  const title = ev && typeof ev.title === "string" && ev.title ? `「${ev.title}」` : "";
  return `${id}${title}`;
}

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

/**
 * 不備 1 件。
 *
 * @typedef {object} Problem
 * @property {string|null} field 主に問題のあるキー（"startDay" など）。
 *   イベント全体の話なら null。呼び出し側が入力欄を名指ししたり
 *   aria-invalid を付けたりするのに使う
 * @property {(nameOf: (key: string) => string) => string} message 本文を作る。
 *   **キー名を直接埋め込まず、必ず nameOf(key) を通すこと。** これがあるから
 *   同じ規則で「lat が範囲外です」（JSON を直接見る人向け）と
 *   「緯度 が範囲外です」（フォームの利用者向け）を出し分けられる。
 *   以前は本文が文字列で、フォーム側が正規表現でキー名を置換していた
 *   ── 置換は本文のどこにでも当たるので、値の中に "start" を含む
 *   イベントがあれば値まで書き換わった（設計書 §13）
 */

/** @returns {Problem} */
const problem = (field, message) => ({ field, message });

/** 名指しを付けない生のキー名。JSON を直接読む人向けの見え方。 */
const rawName = (key) => key;

function checkDayIndex(value, name, dayCount, problems) {
  if (!Number.isInteger(value)) {
    problems.push(problem(name, (n) => `${n(name)} が整数ではありません（${show(value)}）`));
    return false;
  }
  if (value < 0 || value >= dayCount) {
    problems.push(
      problem(
        name,
        (n) => `${n(name)} が範囲外です（${value} / 有効な範囲は 0〜${dayCount - 1}）`
      )
    );
    return false;
  }
  return true;
}

function checkCoords(ev, problems) {
  const latAbsent = isAbsent(ev.lat);
  const lngAbsent = isAbsent(ev.lng);
  if (latAbsent && lngAbsent) return;
  if (latAbsent !== lngAbsent) {
    // 片方だけだと hasCoords が false を返し「座標なし」と同じ扱いになる。
    // 意図的に地図へ出さないイベントと見分けが付かないので、書き間違いとして弾く
    problems.push(
      problem(
        latAbsent ? "lat" : "lng",
        (n) =>
          `${n("lat")} / ${n("lng")} は両方書くか両方 null にしてください` +
          `（${n("lat")}=${show(ev.lat)}, ${n("lng")}=${show(ev.lng)}）`
      )
    );
    return;
  }
  for (const [name, value, limit] of [
    ["lat", ev.lat, 90],
    ["lng", ev.lng, 180],
  ]) {
    if (!isFiniteNumber(value)) {
      problems.push(
        problem(name, (n) => `${n(name)} が有限の数値ではありません（${show(value)}）`)
      );
    } else if (value < -limit || value > limit) {
      problems.push(problem(name, (n) => `${n(name)} が範囲外です（${value} / ±${limit}）`));
    }
  }
}

/**
 * イベント 1 件を検査して、不備の一覧を返す（空配列なら妥当）。
 *
 * Phase B の編集フォームからも呼ぶために公開している。フォーム側が同じ規則を
 * 書き写すと、写しがずれた瞬間に「保存はできるが次の読み込みで
 * validateEvents に弾かれ、ページが起動しない」データを作れてしまう。
 * イベント 1 件に対する規則の置き場所はここ 1 か所だけにする。
 *
 * **返すのは文字列ではなく {field, message} の組**（上の Problem を参照）。
 * イベントの名指し（"ev-006「出国フライト」: "）は付けない ── 1 件しか
 * 扱わない呼び出し側が、あとから文字列を切り直さずに済むようにするため。
 * 名指しを付けるのは validateEvents だけ。
 *
 * @param {object} ev 検査するイベント
 * @param {number} dayCount days の件数
 * @param {Set<string>} seenIds すでに使われている id（重複の検出に使い、
 *   通ったものを足していく）。1 件だけ検査するときは既定の空集合でよい
 * @returns {Problem[]} 不備の一覧
 */
export function validateEvent(ev, dayCount, seenIds = new Set()) {
  const problems = [];

  if (!isPlainObject(ev)) {
    problems.push(problem(null, () => "オブジェクトではありません"));
    return problems;
  }

  // id は地図の再描画判定（map.js の signatureOf）の鍵になる。
  // 重複すると別の地点が同じものとして扱われる
  if (typeof ev.id !== "string" || !ev.id) {
    problems.push(problem("id", (n) => `${n("id")} が空でない文字列ではありません`));
  } else if (seenIds.has(ev.id)) {
    problems.push(problem("id", (n) => `${n("id")} が重複しています`));
  } else {
    seenIds.add(ev.id);
  }

  if (typeof ev.title !== "string") {
    problems.push(problem("title", (n) => `${n("title")} が文字列ではありません`));
  }

  if (!Object.hasOwn(CAT_META, ev.cat)) {
    problems.push(
      problem(
        "cat",
        () =>
          `未知のカテゴリです（${show(ev.cat)} / ` +
          `有効な値は ${Object.keys(CAT_META).join(", ")}）`
      )
    );
  }

  const startOk = checkDayIndex(ev.startDay, "startDay", dayCount, problems);
  const endOk = checkDayIndex(ev.endDay, "endDay", dayCount, problems);
  if (startOk && endOk && ev.endDay < ev.startDay) {
    problems.push(
      problem(
        "endDay",
        (n) => `${n("endDay")}(${ev.endDay}) が ${n("startDay")}(${ev.startDay}) より前です`
      )
    );
  }

  if (!ev.allDay) {
    for (const name of ["start", "end"]) {
      const value = ev[name];
      if (!isFiniteNumber(value)) {
        problems.push(
          problem(
            name,
            (n) =>
              `終日でないイベントの ${n(name)} が有限の数値ではありません（${show(value)}）`
          )
        );
      } else if (value < 0 || value > 24) {
        problems.push(
          problem(name, (n) => `${n(name)} が 0〜24 の範囲外です（${value}）`)
        );
      }
    }
    // start > end は日をまたぐイベントでは正しい（例: 22:10 発 → 翌 06:20 着）ので
    // ここでは弾かない。単日で start > end なら高さが負になるが、
    // buildBlock の下限クランプが吸収するため描画は破綻しない
  }

  checkCoords(ev, problems);

  return problems;
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
    data.events.forEach((ev, i) => {
      // 名指しを付けるのはここだけ（validateEvent は本文しか返さない）。
      // id が無いイベントは配列上の位置で呼ぶ
      const label = labelOf(ev, `events[${i}]`);
      for (const p of validateEvent(ev, data.days.length, seenIds)) {
        problems.push(`${label}: ${p.message(rawName)}`);
      }
    });
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
