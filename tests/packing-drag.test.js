import test from "node:test";
import assert from "node:assert/strict";
import { rebuildFromOrder, attachDrag } from "../assets/js/packing-drag.js";
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
  // 区分ごと order に無いとき、区分に入っていた項目も（区分の id や個数だけでなく
  // 中身の id まで）そのまま戻ること。取りこぼした区分をいったん items: [] で
  // 置いてから元の項目を後ろへ戻す経路が働いていることの確認
  assert.deepEqual(
    next.groups.find((g) => g.id === "g-valuables").items.map((i) => i.id),
    ["passport", "cash", "insurance"],
    "order に無い区分の項目が失われた、または重複しました"
  );
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

// ── attachDrag の配線（Final review の Fix 4） ──────────────────────
//
// attachDrag() 本体は Pointer Events / document.elementFromPoint に依存する
// ので、node --test では通常は対象外（CLAUDE.md「テスト」参照）。ただし
// pointerdown → pointerup だけなら、両方に触れる最小限のスタブで
// 組み立てられる（pointermove・elementFromPoint は使わずに済む）。
// ここで確かめたいのは 1 点だけ ── commit（rebuildFromOrder の結果を渡す先）が
// 同期的に例外を投げても、その例外が pointerup のリスナの外へ漏れず
// onError に渡ること。rebuildFromOrder 自身の「到達不能」の throw は、
// data.groups を自分でしか作れない都合上ここから正規の経路では再現できない
// （2 本のループが data.groups の id を必ず 1 度ずつ置くため）が、
// onPointerUp の try/catch は rebuildFromOrder と commit の両方を
// 同じブロックで囲んでいるので、commit 側の例外で同じ配線を検証できる。

/**
 * テストに要る分だけの要素スタブ。closest はテストごとに個別に差し替える。
 *
 * style と getBoundingClientRect は、掴んだ行を指の下へ動かす follow()
 * （packing-drag.js）が使う。**実 DOM が持つものは、使われるようになった時点で
 * ここにも足すこと** ── 足さないと、このスタブを使うテストが
 * 「TypeError: … is not a function」で落ちる。落ちてくれるのは good news で、
 * 黙って通り抜けるより、噛み合っていないことがその場で分かる。
 */
function stubEl(dataset = {}) {
  return {
    dataset,
    style: {},
    classList: { add() {}, remove() {} },
    setPointerCapture() {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 }),
    closest() {
      return null;
    },
  };
}

test("commit が同期的に例外を投げても、onPointerUp の外へ漏らさず onError へ渡す", () => {
  const item = stubEl({ itemId: "it-001" });
  const groupEl = {
    dataset: { groupId: "g-001" },
    querySelectorAll: (sel) => (sel === "[data-item-id]" ? [item] : []),
  };
  const root = {
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    removeEventListener() {},
    querySelectorAll(sel) {
      return sel === "[data-group-id]" ? [groupEl] : [];
    },
  };

  const handle = stubEl({ dragHandle: "1" });
  handle.closest = (sel) =>
    sel === "[data-drag-handle]" ? handle : sel === "[data-item-id]" ? item : null;

  const windowListeners = {};
  const previousWindow = globalThis.window;
  globalThis.window = {
    addEventListener(type, fn) {
      windowListeners[type] = fn;
    },
    removeEventListener() {},
  };

  const errors = [];
  let drag;
  try {
    drag = attachDrag({
      root,
      getData: () => PACKING,
      commit: () => {
        throw new Error("boom");
      },
      onError: (error) => errors.push(error),
    });

    root.listeners.pointerdown({
      target: handle,
      button: 0,
      pointerId: 1,
      preventDefault() {},
    });
    // pointerdown が dragging をセットできていること（さもないと pointerup は
    // 早期 return し、このテストは commit を一度も呼ばずに「成功」する）
    assert.equal(errors.length, 0, "pointerup より前に onError が呼ばれています");

    windowListeners.pointerup();
  } finally {
    drag?.detach();
    globalThis.window = previousWindow;
  }

  assert.equal(errors.length, 1, "commit の例外が onError に届いていません");
  assert.equal(errors[0].message, "boom");
});

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
