import test from "node:test";
import assert from "node:assert/strict";
import { expandEvents, hasCoords, collectLocations } from "../assets/js/events.js";

const timed = (over = {}) => ({
  id: "e1", cat: "cat-food", title: "昼食",
  allDay: false, startDay: 1, endDay: 1, start: 12, end: 13, ...over,
});

test("単日イベントは1セグメントになる", () => {
  const segs = expandEvents([timed()], 6);
  assert.equal(segs.length, 1);
  assert.deepEqual(
    { day: segs[0].day, start: segs[0].start, end: segs[0].end,
      isFirst: segs[0].isFirst, isLast: segs[0].isLast },
    { day: 1, start: 12, end: 13, isFirst: true, isLast: true }
  );
  assert.equal(segs[0].ref.id, "e1");
});

test("日をまたぐイベントは日ごとに割られる", () => {
  // 8/12 15:00 → 8/14 11:00 のホテル滞在
  const segs = expandEvents([timed({ startDay: 0, endDay: 2, start: 15, end: 11 })], 6);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map((s) => [s.day, s.start, s.end]), [
    [0, 15, 24],
    [1, 0, 24],
    [2, 0, 11],
  ]);
  assert.deepEqual(segs.map((s) => s.isFirst), [true, false, false]);
  assert.deepEqual(segs.map((s) => s.isLast), [false, false, true]);
});

test("すべてのセグメントが同じ実体を指す", () => {
  const ev = timed({ startDay: 0, endDay: 2, start: 15, end: 11 });
  const segs = expandEvents([ev], 6);
  assert.ok(segs.every((s) => s.ref === ev));
});

test("表示日数を超える分は切り捨てる", () => {
  const segs = expandEvents([timed({ startDay: 4, endDay: 9, start: 9, end: 10 })], 6);
  assert.deepEqual(segs.map((s) => s.day), [4, 5]);
});

test("終日イベントは0〜24として展開される", () => {
  const segs = expandEvents([{ id: "a", allDay: true, startDay: 2, endDay: 2 }], 6);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].allDay, true);
  assert.deepEqual([segs[0].start, segs[0].end], [0, 24]);
});

test("endDay が startDay より前でも1セグメントに落とす", () => {
  const segs = expandEvents([timed({ startDay: 3, endDay: 1 })], 6);
  assert.deepEqual(segs.map((s) => s.day), [3]);
});

test("hasCoords は両方揃ったときだけ true", () => {
  assert.equal(hasCoords({ lat: 13.7, lng: 100.5 }), true);
  assert.equal(hasCoords({ lat: 13.7, lng: null }), false);
  assert.equal(hasCoords({ lat: null, lng: 100.5 }), false);
  assert.equal(hasCoords({}), false);
  assert.equal(hasCoords({ lat: 0, lng: 0 }), true);
});

test("collectLocations は同一座標を1件にまとめる", () => {
  const evs = [
    { id: "a", cat: "cat-move", lat: 13.69, lng: 100.75 },
    { id: "b", cat: "cat-move", lat: 13.69, lng: 100.75 },
    { id: "c", cat: "cat-food", lat: 13.73, lng: 100.56 },
    { id: "d", cat: "cat-food", lat: null, lng: null },
  ];
  assert.deepEqual(collectLocations(evs, null).map((e) => e.id), ["a", "c"]);
});

test("collectLocations はカテゴリで絞り込める", () => {
  const evs = [
    { id: "a", cat: "cat-move", lat: 13.69, lng: 100.75 },
    { id: "c", cat: "cat-food", lat: 13.73, lng: 100.56 },
  ];
  assert.deepEqual(collectLocations(evs, "cat-food").map((e) => e.id), ["c"]);
});
