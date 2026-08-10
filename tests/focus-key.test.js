/**
 * フォーカスキーの書式。
 *
 * 値そのものより「組み立てる側と引く側が同じ関数を呼ぶ」ことが目的なので、
 * テストは書式を固定するだけでよい。ここが変わったら両側が一緒に変わる。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { itemFocusKey, groupFocusKey, souvenirFocusKey } from "../assets/js/focus-key.js";

test("itemFocusKey: item:<id>:<field>", () => {
  assert.equal(itemFocusKey("it-001", "name"), "item:it-001:name");
});

test("groupFocusKey: group:<id>:<field>", () => {
  assert.equal(groupFocusKey("g-001", "up"), "group:g-001:up");
});

test("souvenirFocusKey: sv:<id>:<field>", () => {
  assert.equal(souvenirFocusKey("sv-001", "shop"), "sv:sv-001:shop");
});

test("3 つの接頭辞は重ならない（同じ id でも別のキーになる）", () => {
  // 区分 id と項目 id は別の名前空間なので、"x" が両方に存在しうる
  const keys = new Set([
    itemFocusKey("x", "name"),
    groupFocusKey("x", "name"),
    souvenirFocusKey("x", "name"),
  ]);
  assert.equal(keys.size, 3, "接頭辞が衝突しています");
});
