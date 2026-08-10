/**
 * souvenirs-data.js の純粋関数。
 *
 * packing-data.test.js と同じ方針で、「壊れたときの失われ方が静かな」操作を
 * 1 つずつ確かめる ── 「追加したら別の行が消えていた」は、次にそのリストを
 * 見るまで誰も気付かない。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySouvenirs,
  nextSouvenirId,
  withSouvenir,
  withoutSouvenir,
  progressOf,
  shopSuggestions,
} from "../assets/js/souvenirs-data.js";
import { SOUVENIRS } from "./fixtures/souvenirs.js";

/* packing-data.test.js と同じ形。structuredClone ではなく JSON 往復を使うのは、
   既存のテストがそう書いてあるため（読む人が 2 つの流儀を覚えなくて済む）。 */
const clone = () => JSON.parse(JSON.stringify(SOUVENIRS));

test("emptySouvenirs: 空の items を持つ", () => {
  assert.deepEqual(emptySouvenirs(), { items: [] });
});

test("nextSouvenirId: 空なら sv-001", () => {
  assert.equal(nextSouvenirId([]), "sv-001");
});

test("nextSouvenirId: 既存と衝突しない", () => {
  const id = nextSouvenirId(SOUVENIRS.items);
  assert.ok(!SOUVENIRS.items.some((i) => i.id === id), `${id} が既存と衝突しています`);
});

test("nextSouvenirId: 途中を消したデータでも衝突しない", () => {
  // 件数から作った候補が埋まっている状況。件数と最大値がずれるので、
  // 「使われていないこと」を確かめずに採番すると重複する
  const items = [{ id: "sv-001" }, { id: "sv-002" }, { id: "sv-005" }];
  const id = nextSouvenirId(items);
  assert.ok(!items.some((i) => i.id === id), `${id} が既存と衝突しています`);
});

test("withSouvenir: 新しい id なら末尾に足す", () => {
  const data = clone();
  const next = withSouvenir(data, {
    id: "sv-999",
    name: "新しいお土産",
    recipient: "",
    shop: "",
    note: "",
    bought: false,
  });
  assert.equal(next.items.length, SOUVENIRS.items.length + 1);
  assert.equal(next.items.at(-1).id, "sv-999");
});

test("withSouvenir: 既存の id なら位置を変えずに差し替える", () => {
  const data = clone();
  const next = withSouvenir(data, { ...data.items[1], bought: true });
  assert.equal(next.items.length, SOUVENIRS.items.length, "件数が変わっています");
  assert.equal(next.items[1].id, "sv-002", "位置が動いています");
  assert.equal(next.items[1].bought, true);
});

test("withSouvenir: 元のデータを書き換えない", () => {
  const data = clone();
  withSouvenir(data, { ...data.items[0], name: "書き換え" });
  assert.deepEqual(data, SOUVENIRS, "渡したデータが変更されました");
});

test("withoutSouvenir: 指定した行だけ消す", () => {
  const next = withoutSouvenir(clone(), "sv-002");
  assert.equal(next.items.length, SOUVENIRS.items.length - 1);
  assert.ok(!next.items.some((i) => i.id === "sv-002"));
  assert.ok(next.items.some((i) => i.id === "sv-003"), "隣の行まで消えています");
});

test("withoutSouvenir: 無い id を渡しても何も消さない", () => {
  const next = withoutSouvenir(clone(), "sv-nope");
  assert.equal(next.items.length, SOUVENIRS.items.length);
});

test("progressOf: bought の数と全体を返す", () => {
  assert.deepEqual(progressOf(SOUVENIRS), { done: 1, total: 4 });
});

test("progressOf: 空でもゼロ除算にならない値を返す", () => {
  // 割り算は呼び出し側（描画）に任せるので、ここは 0/0 を素直に返す
  assert.deepEqual(progressOf(emptySouvenirs()), { done: 0, total: 0 });
});

test("progressOf: bought が true 以外は買っていない扱い", () => {
  // "true" のような文字列を真として数えない（validate が弾くが、二重の守り）
  const data = { items: [{ id: "a", bought: "true" }, { id: "b", bought: 1 }] };
  assert.deepEqual(progressOf(data), { done: 0, total: 2 });
});

test("shopSuggestions: 重複を落として出現順に返す", () => {
  assert.deepEqual(shopSuggestions(SOUVENIRS), ["空港", "チャトチャック市場"]);
});

test("shopSuggestions: 空文字は候補にしない", () => {
  // sv-004 の shop は "" 。候補に空行が出ると選べてしまう
  assert.ok(!shopSuggestions(SOUVENIRS).includes(""));
});

test("shopSuggestions: 空のリストでは空配列", () => {
  assert.deepEqual(shopSuggestions(emptySouvenirs()), []);
});
