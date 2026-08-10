/**
 * validateSouvenirs()。packing-validate.test.js と同じ方針で、
 * 「破ると静かに壊れる」前提だけを見ていることを確かめる。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSouvenirs,
  validateSouvenir,
  SouvenirDataError,
} from "../assets/js/souvenirs-validate.js";
import { DataError } from "../assets/js/data-error.js";
import { SOUVENIRS } from "./fixtures/souvenirs.js";

const clone = () => JSON.parse(JSON.stringify(SOUVENIRS));

test("SouvenirDataError は DataError を継承する", () => {
  // load-error.js の toLoadError() が DataError で分岐しているので、
  // 継承が切れると読み込み失敗が「取得できませんでした」に化ける
  assert.ok(new SouvenirDataError("x") instanceof DataError);
});

test("正しいデータはそのまま返る", () => {
  const data = clone();
  assert.equal(validateSouvenirs(data), data);
});

test("空のリストは妥当", () => {
  const data = { items: [] };
  assert.equal(validateSouvenirs(data), data);
});

test("トップレベルがオブジェクトでなければ投げる", () => {
  assert.throws(() => validateSouvenirs([]), SouvenirDataError);
  assert.throws(() => validateSouvenirs(null), SouvenirDataError);
});

test("items が配列でなければ名指しで投げる", () => {
  assert.throws(() => validateSouvenirs({ items: {} }), /items が配列ではありません/);
});

test("id が空なら弾く", () => {
  const data = clone();
  data.items[0].id = "";
  assert.throws(() => validateSouvenirs(data), /id が空でない文字列ではありません/);
});

test("id の重複を弾く", () => {
  const data = clone();
  data.items[1].id = data.items[0].id;
  assert.throws(() => validateSouvenirs(data), /id が重複しています/);
});

test("bought が真偽値でなければ弾く", () => {
  // "false" は真として扱われ、進捗が黙って狂う
  const data = clone();
  data.items[0].bought = "false";
  assert.throws(() => validateSouvenirs(data), /買ったかどうかが真偽値ではありません/);
});

test("bought が無い行を弾く", () => {
  const data = clone();
  delete data.items[0].bought;
  assert.throws(() => validateSouvenirs(data), /買ったかどうかが真偽値ではありません/);
});

test("name / recipient / shop は空文字を許す", () => {
  // 「何を」だけ決まっていて相手も店も未定、という行が普通に生まれる（設計書 §4.5）
  const data = { items: [{ id: "sv-001", name: "", recipient: "", shop: "", bought: false }] };
  assert.doesNotThrow(() => validateSouvenirs(data));
});

test("name が文字列でなければ弾く", () => {
  const data = clone();
  data.items[0].name = 123;
  assert.throws(() => validateSouvenirs(data), /name が文字列ではありません/);
});

test("recipient が文字列でなければ弾く", () => {
  const data = clone();
  data.items[0].recipient = null;
  assert.throws(() => validateSouvenirs(data), /recipient が文字列ではありません/);
});

test("shop が文字列でなければ弾く", () => {
  const data = clone();
  data.items[0].shop = {};
  assert.throws(() => validateSouvenirs(data), /shop が文字列ではありません/);
});

test("note は省略できる", () => {
  const data = clone();
  delete data.items[0].note;
  assert.doesNotThrow(() => validateSouvenirs(data));
});

test("note が文字列でなければ弾く", () => {
  const data = clone();
  data.items[0].note = 5;
  assert.throws(() => validateSouvenirs(data), /note が文字列ではありません/);
});

test("不備は 1 件目で止めずにまとめて報告する", () => {
  const data = { items: [{ id: "", name: 1, bought: "no" }] };
  try {
    validateSouvenirs(data);
    assert.fail("投げませんでした");
  } catch (error) {
    assert.match(error.message, /5 件の不備/);
  }
});

test("不備が多いときは先頭だけ出して残りは件数で示す", () => {
  const items = Array.from({ length: 7 }, (_, n) => ({ id: `x-${n}`, name: 1, bought: false }));
  try {
    validateSouvenirs({ items });
    assert.fail("投げませんでした");
  } catch (error) {
    assert.match(error.message, /…ほか 11 件/);
  }
});

test("id を持たない行は配列上の位置で名指しする", () => {
  try {
    validateSouvenirs({ items: [{ name: "x", bought: false }] });
    assert.fail("投げませんでした");
  } catch (error) {
    assert.match(error.message, /items\[0\]/);
  }
});

test("validateSouvenir: 1 件だけを検査して不備の配列を返す", () => {
  const problems = validateSouvenir({ id: "a", name: "x", recipient: "", shop: "", bought: false });
  assert.deepEqual(problems, []);
});

test("validateSouvenir: 渡した Set に id を足していく", () => {
  const seen = new Set();
  validateSouvenir({ id: "a", name: "x", recipient: "", shop: "", bought: false }, seen);
  const problems = validateSouvenir({ id: "a", name: "y", recipient: "", shop: "", bought: false }, seen);
  assert.match(problems.join("\n"), /id が重複しています/);
});

test("recipient / shop はキーごと無いと弾く（空文字とは別）", () => {
  // 編集で誤ってキーを削除すると、次の読み込みで黙って消える（CLAUDE.md の precedent）。
  // 空文字は許すが、キーそのものが無いのは不備
  const withoutRecipient = { id: "sv-001", name: "x", shop: "", bought: false };
  assert.throws(() => validateSouvenirs({ items: [withoutRecipient] }), /recipient が文字列ではありません/);

  const withoutShop = { id: "sv-002", name: "x", recipient: "", bought: false };
  assert.throws(() => validateSouvenirs({ items: [withoutShop] }), /shop が文字列ではありません/);
});
