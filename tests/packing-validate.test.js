import test from "node:test";
import assert from "node:assert/strict";
import { validatePacking, validateItem, PackingDataError } from "../assets/js/packing-validate.js";
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
  assert.ok(
    PACKING.groups.some((g) => g.items.some((i) => i.note)),
    "note を持つ項目が必要（note 省略可のテストに要る）"
  );
  assert.ok(
    PACKING.groups.some((g) => g.items.some((i) => i.note === "")),
    "note が空の項目が必要（note 省略可のテストに要る）"
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

test("項目の id が空でない文字列でなければ、重複ではなく id 不備として投げる", () => {
  const data = clone();
  data.groups[0].items[0].id = "";
  assert.throws(() => validatePacking(data), /id が空でない文字列ではありません/);

  const data2 = clone();
  delete data2.groups[0].items[0].id;
  assert.throws(() => validatePacking(data2), /id が空でない文字列ではありません/);
});

test("区分の name が文字列でなければ、その区分を名指しして投げる", () => {
  // 削除すると、他のテストを通したまま気付かれずに素通りする（自己レビューで発覚した穴）
  const data = clone();
  data.groups[0].name = 42;
  assert.throws(() => validatePacking(data), /g-valuables/);
  assert.throws(() => validatePacking(data), /name が文字列ではありません/);
});

test("区分の items が配列でなければ、クラッシュせず名指しした不備として投げる", () => {
  // 削除すると group.items.forEach が生の TypeError を投げるようになる ──
  // 「名指しして集めて報告する」という、このモジュールの核になる約束が壊れる
  const data = clone();
  data.groups[0].items = null;
  try {
    validatePacking(data);
    assert.fail("投げていません");
  } catch (error) {
    assert.ok(error instanceof PackingDataError, "PackingDataError であるべき");
    assert.ok(!(error instanceof TypeError), "生の TypeError ではないはず");
    assert.match(error.message, /g-valuables/);
    assert.match(error.message, /items が配列ではありません/);
  }

  const data2 = clone();
  data2.groups[0].items = {};
  assert.throws(() => validatePacking(data2), PackingDataError);
});

test("区分そのものがオブジェクトでなければ、位置で名指しして投げる", () => {
  const data = clone();
  data.groups[0] = null;
  assert.throws(() => validatePacking(data), /groups\[0\]/);
});

test("項目そのものがオブジェクトでなければ、位置で名指しして投げる", () => {
  const data = clone();
  data.groups[0].items[0] = null;
  assert.throws(() => validatePacking(data), /items\[0\]/);
});

test("note が文字列でなければ、その項目を名指しして投げる", () => {
  const data = clone();
  data.groups[0].items[1].note = 42; // cash
  assert.throws(() => validatePacking(data), /cash/);
  assert.throws(() => validatePacking(data), /note が文字列ではありません/);
});

test("b だけが真偽値でなくても、a 単独と同様に投げる", () => {
  const data = clone();
  data.groups[0].items[0].b = "true";
  assert.throws(() => validatePacking(data), /passport/);
  assert.throws(() => validatePacking(data), /b のチェック状態が真偽値ではありません/);
});

/* ── where（入れる場所）── */

test("where は省略できる（未設定・空文字の両方）", () => {
  const data = clone();
  delete data.groups[0].items[0].where;
  assert.equal(validatePacking(data), data);

  const data2 = clone();
  data2.groups[0].items[0].where = "";
  assert.equal(validatePacking(data2), data2);
});

test("既知の入れる場所は通る", () => {
  const data = clone();
  data.groups[0].items[0].where = "hand";
  data.groups[0].items[1].where = "cabin";
  data.groups[0].items[2].where = "checked";
  assert.equal(validatePacking(data), data);
});

test("未知の入れる場所は名指しして投げる", () => {
  // 通してしまうと画面はラベルを引けず、何も出ないチップになる。
  // 「設定したのに出ない」という静かな壊れ方になるので読み込み時に止める
  const data = clone();
  data.groups[0].items[0].where = "backpack";
  assert.throws(() => validatePacking(data), /passport/);
  assert.throws(() => validatePacking(data), /backpack/);
});

test("where が文字列でなければ投げる", () => {
  const data = clone();
  data.groups[0].items[0].where = 3;
  assert.throws(() => validatePacking(data), /passport/);
  assert.throws(() => validatePacking(data), /where/);
});

test("PLACE_META のキーはすべて検証を通る（定義と検査がずれない）", async () => {
  // 場所を足したのに検証だけ古い、を防ぐ。一覧を書き写さず PLACE_META から導く
  const { PLACE_META } = await import("../assets/js/packing-data.js");
  const keys = Object.keys(PLACE_META);
  assert.ok(keys.length >= 3, "PLACE_META が空です");
  for (const key of keys) {
    const data = clone();
    data.groups[0].items[0].where = key;
    assert.equal(validatePacking(data), data, `${key} が検証に落ちました`);
  }
});

/* ── na（その人には不要）── */

test("na は省略できる（既存の項目がそのまま通る）", () => {
  const item = { id: "x", name: "現金", a: true, b: false };
  assert.deepEqual(validateItem(item), []);
});

test("na が配列でなければ弾く", () => {
  const item = { id: "x", name: "現金", a: true, b: false, na: "b" };
  const problems = validateItem(item);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /na が配列ではありません/);
});

test("na に未知の人が入っていれば弾く", () => {
  const item = { id: "x", name: "現金", a: true, b: false, na: ["c"] };
  assert.match(validateItem(item)[0], /na に未知の人/);
});

test("na の重複を弾く", () => {
  const item = { id: "x", name: "現金", a: true, b: false, na: ["b", "b"] };
  assert.match(validateItem(item)[0], /2 回/);
});

test("全員に不要な項目は弾く", () => {
  // どちらの分母にも入らない項目は、リストに在っても誰の役にも立たない。
  // 許すと「進捗は 39/39 なのに画面には項目が並んでいる」が作れてしまう
  const item = { id: "x", name: "現金", a: true, b: false, na: ["a", "b"] };
  assert.match(validateItem(item).join("\n"), /全員に不要/);
});

test("na があっても a / b の真偽値必須は変わらない", () => {
  const item = { id: "x", name: "現金", a: "true", b: false, na: ["b"] };
  assert.match(validateItem(item)[0], /真偽値ではありません/);
});
