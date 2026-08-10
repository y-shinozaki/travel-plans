/**
 * packing.json の形を、描画が始まる前に一度だけ検査する。
 *
 * validate.js（旅程）と同じ方針で書いてある:
 * 破ると静かに壊れる前提だけを見て、不備は 1 件目で止めずに全部集め、
 * どの項目の何が悪いのかを名指しする。
 *
 * ここで見る「静かに壊れる」の中身:
 *
 * - a / b が真偽値でないと進捗が黙って狂う（"false" は真になる）
 * - 項目の id が重複すると、チェックの切り替えが別の項目に飛ぶ
 *   （行の特定に data-id を使うため）。B3 のコメントも packing:<id> で
 *   項目を指すので、区分をまたいで一意である必要がある
 * - 未知の icon は icons.js の icon() が例外を投げる。描画のたびに落ちるより、
 *   読み込み時に「どの区分のアイコンが未知か」を名指しして止めるほうがいい
 *
 * 設計書 §4.2 に対応。
 */

import { DataError } from "./data-error.js";
import { ICON_IDS } from "./icons.js";

/** 持ち物データ内容の不備。通信・パース失敗とは呼び出し側で区別する。 */
export class PackingDataError extends DataError {
  constructor(message) {
    super(message);
    this.name = "PackingDataError";
  }
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v !== "";
const show = (v) => (typeof v === "number" ? String(v) : JSON.stringify(v));

/**
 * エラー文で項目を名指しするためのラベル。
 * validate.js の labelOf と同じ形（`${id}「${name}」`）にしてある。
 */
function labelOf(node, where) {
  const id = isNonEmptyString(node?.id) ? node.id : where;
  const name = isNonEmptyString(node?.name) ? `「${node.name}」` : "";
  return `${id}${name}`;
}

/**
 * アイコンは省略できる。指定されている場合だけスプライトにあるかを見る。
 * 未設定（undefined）と空文字の両方を「無し」として扱う ── JSON では
 * どちらの書き方もされるため。
 */
function checkIcon(icon, label, problems) {
  if (icon === undefined || icon === "") return;
  if (typeof icon !== "string") {
    problems.push(`${label}: icon が文字列ではありません（${show(icon)}）`);
    return;
  }
  if (!ICON_IDS.includes(icon)) {
    problems.push(`${label}: 未知のアイコンです（${icon}）`);
  }
}

/**
 * id が空でない文字列であること、かつ渡された集合内で重複していないことを検査する。
 * 通れば集合に加える。group と item の両方が同じ形の規則を持つのでここに集約する ──
 * 重複時の文言だけは呼び出し側で変えられるようにしてある（区分は「区分の id が
 * 重複しています」、項目は「id が重複しています」で、この違いは意図的に残す。
 * 項目は複数の区分をまたいで同じ id 空間を共有するので、呼ばれる側が渡す
 * `seenIds` がそのまま「どこまでが同じ名前空間か」を決める）。
 */
function checkUniqueId(node, seenIds, where, label, duplicateMessage, problems) {
  if (!isNonEmptyString(node.id)) {
    problems.push(`${where}: id が空でない文字列ではありません`);
  } else if (seenIds.has(node.id)) {
    problems.push(`${label}: ${duplicateMessage}`);
  } else {
    seenIds.add(node.id);
  }
}

/** name が文字列であることを検査する。group と item で文言の形は同じ。 */
function checkNameType(node, label, problems) {
  if (typeof node.name !== "string") {
    problems.push(`${label}: name が文字列ではありません（${show(node.name)}）`);
  }
}

/**
 * 項目 1 件を検査して、不備の一覧を返す（空配列なら妥当）。
 *
 * 編集フォームからも呼べるよう公開している。**項目 1 件に対する規則の
 * 置き場所はここ 1 か所だけ**にする ── フォーム側が書き写すと、写しがずれた
 * 瞬間に「保存はできるが次の読み込みで弾かれる」データを作れてしまう
 * （旅程の validateEvent / formProblems と同じ関係）。
 *
 * @param {object} item 検査する項目
 * @param {Set<string>} seenIds すでに使われている項目 id。通ったものを足していく
 * @param {string} where id を持たない項目の呼び方
 * @returns {string[]} 不備の一覧
 */
export function validateItem(item, seenIds = new Set(), where = "項目") {
  const problems = [];

  if (!isPlainObject(item)) {
    problems.push(`${where} がオブジェクトではありません`);
    return problems;
  }

  const label = labelOf(item, where);

  // 区分をまたいで一意。行の特定にも B3 のコメントの対象キーにも使う
  checkUniqueId(item, seenIds, where, label, "id が重複しています", problems);

  checkNameType(item, label, problems);

  // note は省略できる
  if (item.note !== undefined && typeof item.note !== "string") {
    problems.push(`${label}: note が文字列ではありません（${show(item.note)}）`);
  }

  for (const member of ["a", "b"]) {
    if (typeof item[member] !== "boolean") {
      // "false" のような文字列は真として扱われ、進捗が黙って狂う
      problems.push(
        `${label}: ${member} のチェック状態が真偽値ではありません（${show(item[member])}）`
      );
    }
  }

  return problems;
}

function checkGroup(group, seenGroupIds, seenItemIds, where, problems) {
  if (!isPlainObject(group)) {
    problems.push(`${where} がオブジェクトではありません`);
    return;
  }

  const label = labelOf(group, where);

  checkUniqueId(group, seenGroupIds, where, label, "区分の id が重複しています", problems);

  checkNameType(group, label, problems);

  checkIcon(group.icon, label, problems);

  if (!Array.isArray(group.items)) {
    problems.push(`${label}: items が配列ではありません`);
    return;
  }
  group.items.forEach((item, i) =>
    problems.push(...validateItem(item, seenItemIds, `${label} の items[${i}]`))
  );
}

/**
 * 検査に通れば data をそのまま返す。通らなければ PackingDataError を投げる。
 * 戻り値を使うことで、呼び出し側が「検査してから代入する」形に自然に書ける。
 */
export function validatePacking(data) {
  const problems = [];

  if (!isPlainObject(data)) {
    throw new PackingDataError("packing.json のトップレベルがオブジェクトではありません");
  }

  if (!isPlainObject(data.members)) {
    problems.push("members がオブジェクトではありません");
  } else {
    for (const member of ["a", "b"]) {
      if (!isNonEmptyString(data.members[member])) {
        problems.push(
          `members.${member} が空でない文字列ではありません（${show(data.members[member])}）`
        );
      }
    }
  }

  if (!Array.isArray(data.groups)) {
    problems.push("groups が配列ではありません");
  } else {
    // 区分 id と項目 id は別の名前空間。項目だけが区分をまたいで一意である必要がある
    const seenGroupIds = new Set();
    const seenItemIds = new Set();
    data.groups.forEach((group, i) =>
      checkGroup(group, seenGroupIds, seenItemIds, `groups[${i}]`, problems)
    );
  }

  if (problems.length) {
    // 全部並べると数百行になりうるので先頭だけ出し、残りは件数で示す
    const shown = problems.slice(0, 10);
    const rest = problems.length - shown.length;
    const tail = rest > 0 ? `\n…ほか ${rest} 件` : "";
    throw new PackingDataError(
      `持ち物データに ${problems.length} 件の不備があります:\n- ${shown.join("\n- ")}${tail}`
    );
  }

  return data;
}
