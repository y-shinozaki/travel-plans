import test from "node:test";
import assert from "node:assert/strict";
import { rebuildFromOrder } from "../assets/js/packing-drag.js";
import { validatePacking } from "../assets/js/packing-validate.js";
import { PACKING } from "./fixtures/packing.js";

const clone = () => JSON.parse(JSON.stringify(PACKING));
const shape = (data) => data.groups.map((g) => [g.id, g.items.map((i) => i.id)]);
/** 現在の並びをそのまま order の形にする。 */
const orderOf = (data) =>
  data.groups.map((g) => ({ id: g.id, itemIds: g.items.map((i) => i.id) }));

test("同じ並びを渡せば内容は変わらない", () => {
  const data = clone();
  const next = rebuildFromOrder(data, orderOf(data));
  assert.deepEqual(shape(next), shape(data));
});

test("区分をまたいで項目を移した並びを反映する", () => {
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["cash", "passport"] },
    { id: "g-clothes", itemIds: ["insurance", "swimwear"] },
    { id: "g-empty", itemIds: [] },
  ]);
  assert.deepEqual(shape(next), [
    ["g-valuables", ["cash", "passport"]],
    ["g-clothes", ["insurance", "swimwear"]],
    ["g-empty", []],
  ]);
  // 中身は運ばれている（id だけ並べ替えて実体を捨てていないこと）
  const moved = next.groups[1].items.find((i) => i.id === "insurance");
  assert.equal(moved.name, "海外旅行保険の控え");
});

test("区分そのものの並べ替えも反映する", () => {
  const data = clone();
  const reversed = orderOf(data).reverse();
  assert.deepEqual(
    rebuildFromOrder(data, reversed).groups.map((g) => g.id),
    ["g-empty", "g-clothes", "g-valuables"]
  );
});

test("order に無い項目は落とさず、元の区分の末尾に残す", () => {
  // DOM の読み取りが取りこぼしたときに、項目が黙って消えないための保険。
  // ドラッグ中に別のタブで保存された、描画が途中で失敗した、などで起こりうる
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["passport"] },
    { id: "g-clothes", itemIds: ["swimwear"] },
    { id: "g-empty", itemIds: [] },
  ]);
  const all = next.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.ok(all.includes("cash"), "order に無い cash が消えました");
  assert.ok(all.includes("insurance"), "order に無い insurance が消えました");
  assert.equal(all.length, 4, "件数が変わっています");
});

test("order に無い区分も落とさない", () => {
  const data = clone();
  const next = rebuildFromOrder(data, [{ id: "g-clothes", itemIds: ["swimwear"] }]);
  assert.equal(next.groups.length, 3);
  assert.equal(next.groups[0].id, "g-clothes", "order にある区分が先頭に来ること");
});

test("知らない id が混ざっていても落ちない", () => {
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["passport", "it-ghost", "cash", "insurance"] },
    { id: "g-ghost", itemIds: ["it-ghost"] },
    { id: "g-clothes", itemIds: ["swimwear"] },
    { id: "g-empty", itemIds: [] },
  ]);
  assert.equal(validatePacking(next), next);
  const all = next.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.ok(!all.includes("it-ghost"));
});

test("組み直した結果は必ず検査を通る", () => {
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-empty", itemIds: ["passport", "swimwear"] },
    { id: "g-valuables", itemIds: [] },
    { id: "g-clothes", itemIds: ["cash", "insurance"] },
  ]);
  assert.equal(validatePacking(next), next);
});

// ここから下は Task 7 の必須セルフチェックで見つけた抜け穴を埋めるテスト。
// 「削除したら落ちるテストが無い」規則・保護のそれぞれに 1 本ずつ対応する。

test("order に同じ区分 id が重複しても 1 回しか置かない", () => {
  // placedGroups の重複排除。無いと同じ区分が 2 回並ぶ
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["passport", "cash", "insurance"] },
    { id: "g-valuables", itemIds: [] }, // 2 回目は無視されるはず
    { id: "g-clothes", itemIds: ["swimwear"] },
    { id: "g-empty", itemIds: [] },
  ]);
  const matches = next.groups.filter((g) => g.id === "g-valuables");
  assert.equal(matches.length, 1, "g-valuables が複数回並びました");
  assert.deepEqual(
    matches[0].items.map((i) => i.id),
    ["passport", "cash", "insurance"],
    "1 回目の中身が残っていること"
  );
});

test("order に同じ項目 id が重複しても 1 回しか置かない", () => {
  // placedItems の重複排除。無いと項目が 2 つの区分に同時に現れる
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["passport", "cash", "insurance"] },
    { id: "g-clothes", itemIds: ["cash", "swimwear"] }, // cash は既に置かれた後
    { id: "g-empty", itemIds: [] },
  ]);
  assert.deepEqual(
    next.groups.find((g) => g.id === "g-clothes").items.map((i) => i.id),
    ["swimwear"],
    "2 回目の cash が置かれてしまいました"
  );
  const all = next.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(all.length, 4, "cash が 2 つに増えています");
});

test("order に無い区分が複数あるとき、元の相対順のまま並ぶ", () => {
  // 「order に無い区分も落とさない」テストは 1 個だけ抜けている場合しか見ておらず、
  // 残り 2 個の順序までは確かめていない。ここでその順序を確かめる
  const data = clone();
  const next = rebuildFromOrder(data, [{ id: "g-clothes", itemIds: ["swimwear"] }]);
  assert.deepEqual(
    next.groups.map((g) => g.id),
    ["g-clothes", "g-valuables", "g-empty"]
  );
});

test("order に無い項目が複数あるとき、元の相対順のまま末尾に並ぶ", () => {
  // 「末尾に残す」テストは含まれること／件数しか見ておらず、
  // 順序と「先頭ではなく末尾」であることは確かめていない
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["passport"] },
    { id: "g-clothes", itemIds: ["swimwear"] },
    { id: "g-empty", itemIds: [] },
  ]);
  assert.deepEqual(
    next.groups.find((g) => g.id === "g-valuables").items.map((i) => i.id),
    ["passport", "cash", "insurance"]
  );
});

/** 再帰的に凍結する。凍結したオブジェクトへの代入は strict mode で必ず例外になる。 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test("入力データを書き換えない", () => {
  // data を凍結してから渡す。1 か所でも直接代入していれば
  // strict mode の例外でこのテストごと落ちる
  const data = deepFreeze(clone());
  const before = JSON.stringify(data);
  const next = rebuildFromOrder(data, [
    { id: "g-clothes", itemIds: ["swimwear"] },
    { id: "g-empty", itemIds: [] },
    { id: "g-valuables", itemIds: ["cash", "passport"] },
  ]);
  assert.equal(JSON.stringify(data), before, "入力データの中身が変わりました");
  assert.notEqual(next, data, "新しいオブジェクトを返していること");
});
