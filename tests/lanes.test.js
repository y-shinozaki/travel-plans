import test from "node:test";
import assert from "node:assert/strict";
import { assignLanes } from "../assets/js/lanes.js";

const seg = (start, end, id) => ({ id, start, end });

test("重ならないイベントはすべて同じレーンに入る", () => {
  const out = assignLanes([seg(9, 10, "a"), seg(11, 12, "b"), seg(13, 14, "c")]);
  assert.deepEqual(out.map((s) => s.lane), [0, 0, 0]);
  assert.deepEqual(out.map((s) => s.laneCount), [1, 1, 1]);
});

test("終わりと始まりが接するイベントは同じレーンに入る", () => {
  const out = assignLanes([seg(9, 10, "a"), seg(10, 11, "b")]);
  assert.deepEqual(out.map((s) => s.lane), [0, 0]);
  assert.deepEqual(out.map((s) => s.laneCount), [1, 1]);
});

test("重なるイベントは別レーンに分かれる", () => {
  const out = assignLanes([seg(9, 12, "a"), seg(10, 11, "b")]);
  assert.deepEqual(out.map((s) => [s.id, s.lane]), [["a", 0], ["b", 1]]);
  assert.deepEqual(out.map((s) => s.laneCount), [2, 2]);
});

test("3件が重なると3レーンになる", () => {
  const out = assignLanes([seg(9, 12, "a"), seg(9.5, 12, "b"), seg(10, 12, "c")]);
  assert.deepEqual(out.map((s) => s.lane), [0, 1, 2]);
  assert.ok(out.every((s) => s.laneCount === 3));
});

test("空いたレーンは再利用される", () => {
  // a と b が重なり、a が終わったあとの c は a のレーンに戻る
  const out = assignLanes([seg(9, 10, "a"), seg(9.5, 13, "b"), seg(10.5, 11, "c")]);
  const byId = Object.fromEntries(out.map((s) => [s.id, s.lane]));
  assert.equal(byId.a, 0);
  assert.equal(byId.b, 1);
  assert.equal(byId.c, 0);
  assert.ok(out.every((s) => s.laneCount === 2));
});

test("入力順に関わらず開始時刻順で返る", () => {
  const out = assignLanes([seg(13, 14, "c"), seg(9, 10, "a"), seg(11, 12, "b")]);
  assert.deepEqual(out.map((s) => s.id), ["a", "b", "c"]);
});

test("元の配列を書き換えない", () => {
  const input = [seg(9, 10, "a")];
  assignLanes(input);
  assert.equal("lane" in input[0], false);
});

test("空配列を渡しても落ちない", () => {
  assert.deepEqual(assignLanes([]), []);
});
