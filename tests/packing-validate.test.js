import test from "node:test";
import assert from "node:assert/strict";
import { validatePacking, PackingDataError } from "../assets/js/packing-validate.js";
import { DataError } from "../assets/js/data-error.js";
import { PACKING } from "./fixtures/packing.js";

/** フィクスチャを壊さずに 1 か所だけ差し替えた複製を作る。 */
const clone = () => JSON.parse(JSON.stringify(PACKING));

test("フィクスチャはそのまま検査を通る", () => {
  assert.equal(validatePacking(PACKING), PACKING);
});

test("フィクスチャが検査の意味を保っている（番人）", () => {
  // 減らすと、以下のテストが「通るが何も検査していない」状態になる
  assert.ok(PACKING.groups.length >= 2, "区分が 2 つ以上必要（並べ替えのテストに要る）");
  assert.ok(
    PACKING.groups.some((g) => g.items.length === 0),
    "空の区分が必要（進捗のゼロ除算のテストに要る）"
  );
  assert.ok(
    PACKING.groups.some((g) => g.items.some((i) => i.a !== i.b)),
    "a と b でチェックが違う項目が必要（進捗が別々に出ることのテストに要る）"
  );
});

test("PackingDataError は DataError を継承している", () => {
  // load-error.js が「データ内容の不備」として分類できるための約束
  assert.ok(new PackingDataError("x") instanceof DataError);
});

test("トップレベルがオブジェクトでなければ投げる", () => {
  assert.throws(() => validatePacking(null), PackingDataError);
  assert.throws(() => validatePacking([]), PackingDataError);
});

test("members の 2 人が空でない文字列でなければ投げる", () => {
  const data = clone();
  data.members.a = "";
  assert.throws(() => validatePacking(data), /members\.a/);

  const data2 = clone();
  delete data2.members.b;
  assert.throws(() => validatePacking(data2), /members\.b/);
});

test("groups が配列でなければ投げる。空配列は通す", () => {
  const data = clone();
  data.groups = {};
  assert.throws(() => validatePacking(data), /groups/);

  const empty = { members: { a: "雄一", b: "朱汰" }, groups: [] };
  assert.equal(validatePacking(empty), empty);
});

test("区分の id が重複していれば名指しして投げる", () => {
  const data = clone();
  data.groups[1].id = data.groups[0].id;
  assert.throws(() => validatePacking(data), /g-valuables/);
});

test("項目の id は区分をまたいで一意（B3 が packing:<id> で参照するため）", () => {
  const data = clone();
  data.groups[1].items[0].id = "passport";
  assert.throws(() => validatePacking(data), /passport/);
});

test("チェック状態が真偽値でなければ投げる", () => {
  // "false" のような文字列は真になるので、進捗が黙って狂う
  const data = clone();
  data.groups[0].items[0].a = "false";
  assert.throws(() => validatePacking(data), /passport/);
  assert.throws(() => validatePacking(data), /真偽値/);
});

test("未知のアイコン id は投げる", () => {
  // icon() は未知の id で例外を投げる。描画のたびに落ちるより読み込み時に止める
  const data = clone();
  data.groups[0].icon = "i-nonexistent";
  assert.throws(() => validatePacking(data), /i-nonexistent/);
});

test("アイコンは省略できる（空文字と未設定の両方）", () => {
  const data = clone();
  data.groups[0].icon = "";
  assert.equal(validatePacking(data), data);

  const data2 = clone();
  delete data2.groups[1].icon;
  assert.equal(validatePacking(data2), data2);
});

test("不備は 1 件目で止めずにまとめて報告する", () => {
  const data = clone();
  data.groups[0].items[0].a = "false";
  data.groups[0].items[1].name = 42;
  data.groups[1].id = "";
  try {
    validatePacking(data);
    assert.fail("投げていません");
  } catch (error) {
    assert.match(error.message, /3 件の不備/);
  }
});
