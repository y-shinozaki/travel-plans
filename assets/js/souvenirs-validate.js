/**
 * souvenirs.json の形を、描画が始まる前に一度だけ検査する。
 *
 * validate.js（旅程）/ packing-validate.js（持ち物）と同じ方針:
 * 破ると静かに壊れる前提だけを見て、不備は 1 件目で止めずに全部集め、
 * どの行の何が悪いのかを名指しする。
 *
 * ここで見る「静かに壊れる」の中身:
 *
 * - id が重複すると、チェックの切り替えが別の行に飛ぶ（行の特定に data-id を使う）
 * - bought が真偽値でないと進捗が黙って狂う（"false" は真になる）
 *
 * name / recipient / shop に**空文字を許す**のは意図的（設計書 §4.5）──
 * 「何を」だけ決まっていて相手も店も未定、という行が普通に生まれる。
 * ここを必須にすると、思いついたものを書き留められない。
 *
 * 設計書 §4.5 に対応。
 */

import { DataError } from "./data-error.js";

/** お土産データ内容の不備。通信・パース失敗とは呼び出し側で区別する。 */
export class SouvenirDataError extends DataError {
  constructor(message) {
    super(message);
    this.name = "SouvenirDataError";
  }
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v !== "";
const show = (v) => (typeof v === "number" ? String(v) : JSON.stringify(v));

/** エラー文で行を名指しするためのラベル。packing-validate.js の labelOf と同じ形。 */
function labelOf(item, where) {
  const id = isNonEmptyString(item?.id) ? item.id : where;
  const name = isNonEmptyString(item?.name) ? `「${item.name}」` : "";
  return `${id}${name}`;
}

/**
 * 1 行を検査して、不備の一覧を返す（空配列なら妥当）。
 *
 * **1 行に対する規則の置き場所はここ 1 か所だけ**にする ── 画面側が書き写すと、
 * 写しがずれた瞬間に「保存はできるが次の読み込みで弾かれる」データを作れてしまう
 * （validate.js の validateEvent / formProblems と同じ関係）。
 *
 * @param {object} item 検査する行
 * @param {Set<string>} seenIds すでに使われている id。通ったものを足していく
 * @param {string} where id を持たない行の呼び方
 * @returns {string[]} 不備の一覧
 */
export function validateSouvenir(item, seenIds = new Set(), where = "お土産") {
  const problems = [];

  if (!isPlainObject(item)) {
    problems.push(`${where} がオブジェクトではありません`);
    return problems;
  }

  const label = labelOf(item, where);

  if (!isNonEmptyString(item.id)) {
    problems.push(`${where}: id が空でない文字列ではありません`);
  } else if (seenIds.has(item.id)) {
    problems.push(`${label}: id が重複しています`);
  } else {
    seenIds.add(item.id);
  }

  // 空文字は許す。型だけを見る（設計書 §4.5）
  // 空文字が許される一方、キーそのものが無い行は弾く── packing-validate と同じ理由で、
  // 編集で誤ってこのキーを消すと、次の読み込みで弾かれずに黙って消えた状態になる
  // （CLAUDE.md に precedent がある: image / imagePos が非表示のまま読み込まれたことがあった）
  for (const [field, jp] of [
    ["name", "name"],
    ["recipient", "recipient"],
    ["shop", "shop"],
  ]) {
    if (typeof item[field] !== "string") {
      problems.push(`${label}: ${jp} が文字列ではありません（${show(item[field])}）`);
    }
  }

  // note は省略できる
  if (item.note !== undefined && typeof item.note !== "string") {
    problems.push(`${label}: note が文字列ではありません（${show(item.note)}）`);
  }

  if (typeof item.bought !== "boolean") {
    // "false" のような文字列は真として扱われ、進捗が黙って狂う
    problems.push(`${label}: 買ったかどうかが真偽値ではありません（${show(item.bought)}）`);
  }

  return problems;
}

/**
 * 検査に通れば data をそのまま返す。通らなければ SouvenirDataError を投げる。
 * 戻り値を使うことで、呼び出し側が「検査してから代入する」形に自然に書ける。
 */
export function validateSouvenirs(data) {
  const problems = [];

  if (!isPlainObject(data)) {
    throw new SouvenirDataError("souvenirs.json のトップレベルがオブジェクトではありません");
  }

  if (!Array.isArray(data.items)) {
    problems.push("items が配列ではありません");
  } else {
    const seenIds = new Set();
    data.items.forEach((item, i) =>
      problems.push(...validateSouvenir(item, seenIds, `items[${i}]`))
    );
  }

  if (problems.length) {
    // 全部並べると数百行になりうるので先頭だけ出し、残りは件数で示す
    const shown = problems.slice(0, 10);
    const rest = problems.length - shown.length;
    const tail = rest > 0 ? `\n…ほか ${rest} 件` : "";
    throw new SouvenirDataError(
      `お土産データに ${problems.length} 件の不備があります:\n- ${shown.join("\n- ")}${tail}`
    );
  }

  return data;
}
