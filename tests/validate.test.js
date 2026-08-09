/**
 * 読み込み時のデータ検査。
 *
 * ここが黙って通してしまうと、下流では「カレンダーからイベントが 1 件消える」
 * 「地図が無言で壊れる」「クリックした瞬間に素の TypeError」といった、
 * 原因に辿り着きにくい壊れ方になる。
 * どの不備も「例外になる」だけでなく「どのイベントか名指しする」ことを見る。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateEvents, EventDataError } from "../assets/js/validate.js";

const DAYS = [
  { date: "8/12", dow: "水" },
  { date: "8/13", dow: "木" },
];

const ev = (over = {}) => ({
  id: "ev-001",
  cat: "cat-food",
  title: "昼食",
  allDay: false,
  startDay: 0,
  endDay: 0,
  start: 12,
  end: 13,
  lat: null,
  lng: null,
  ...over,
});

const data = (events, days = DAYS) => ({ days, events });

/** 例外になり、かつメッセージに needle が含まれることを確かめる。 */
function assertRejects(input, needle) {
  assert.throws(
    () => validateEvents(input),
    (error) => {
      assert.ok(error instanceof EventDataError, `EventDataError ではありません: ${error}`);
      assert.ok(
        error.message.includes(needle),
        `メッセージに "${needle}" が含まれません:\n${error.message}`
      );
      return true;
    }
  );
}

test("正しいデータはそのまま返る", () => {
  const input = data([ev(), ev({ id: "ev-002", allDay: true, start: undefined, end: undefined })]);
  assert.equal(validateEvents(input), input);
});

test("座標は両方あっても両方無くても通る", () => {
  assert.doesNotThrow(() => validateEvents(data([ev({ lat: 13.7, lng: 100.5 })])));
  assert.doesNotThrow(() => validateEvents(data([ev({ lat: 0, lng: 0 })])));
  const noKeys = ev();
  delete noKeys.lat;
  delete noKeys.lng;
  assert.doesNotThrow(() => validateEvents(data([noKeys])));
});

test("日をまたいで start > end になるイベントは正しい形として通す", () => {
  // 実データの ev-010（22:10 発 → 翌 06:20 着）。ここを弾いてはいけない
  assert.doesNotThrow(() =>
    validateEvents(data([ev({ startDay: 0, endDay: 1, start: 22.17, end: 6.33 })]))
  );
});

/* ── 4 つの静かな壊れ方 ───────────────────────────────── */

test("startDay が日数を超えるイベントを名指しで弾く", () => {
  // expandEvents は 0 セグメントを返すだけで、カレンダーから静かに消えていた
  assertRejects(data([ev({ id: "ev-lost", startDay: 5, endDay: 5 })]), "ev-lost");
  assertRejects(data([ev({ id: "ev-lost", startDay: 5, endDay: 5 })]), "startDay");
});

test("endDay が日数を超えるイベントを名指しで弾く", () => {
  assertRejects(data([ev({ id: "ev-over", endDay: 9 })]), "endDay");
});

test("startDay が負・小数・非数値のいずれでも弾く", () => {
  for (const bad of [-1, 0.5, "0", null, undefined, NaN]) {
    assertRejects(data([ev({ id: "ev-bad", startDay: bad })]), "ev-bad");
  }
});

test("endDay が startDay より前なら弾く", () => {
  assertRejects(data([ev({ id: "ev-rev", startDay: 1, endDay: 0 })]), "startDay(1)");
});

test("NaN / Infinity の座標を弾く", () => {
  // NaN != null は true なので hasCoords をすり抜け、L.marker まで届いていた
  for (const bad of [NaN, Infinity, -Infinity, "13.7"]) {
    assertRejects(data([ev({ id: "ev-nan", lat: bad, lng: 100.5 })]), "ev-nan");
    assertRejects(data([ev({ id: "ev-nan", lat: 13.7, lng: bad })]), "ev-nan");
  }
});

test("片側だけの座標を弾く", () => {
  // 「座標なし」と見分けが付かないまま地図から消えていた
  assertRejects(data([ev({ id: "ev-half", lat: 13.7, lng: null })]), "両方");
  assertRejects(data([ev({ id: "ev-half", lat: null, lng: 100.5 })]), "ev-half");
});

test("緯度経度の範囲外を弾く", () => {
  assertRejects(data([ev({ id: "ev-far", lat: 91, lng: 100.5 })]), "lat が範囲外");
  assertRejects(data([ev({ id: "ev-far", lat: 13.7, lng: 181 })]), "lng が範囲外");
});

/* ── その他の前提 ─────────────────────────────────────── */

test("未知のカテゴリを名指しで弾く", () => {
  assertRejects(data([ev({ id: "ev-cat", cat: "cat-transport" })]), "cat-transport");
});

test("終日でないイベントの start / end が有限でなければ弾く", () => {
  for (const bad of [undefined, null, NaN, "12:00"]) {
    assertRejects(data([ev({ id: "ev-t", start: bad })]), "start");
    assertRejects(data([ev({ id: "ev-t", end: bad })]), "end");
  }
  assertRejects(data([ev({ id: "ev-t", start: 25 })]), "0〜24");
});

test("終日イベントは start / end を持たなくてよい", () => {
  const allDay = ev({ id: "ev-hotel", allDay: true });
  delete allDay.start;
  delete allDay.end;
  assert.doesNotThrow(() => validateEvents(data([allDay])));
});

test("Infinity / NaN はエラー文でもそのまま Infinity / NaN と出る", () => {
  // JSON.stringify(Infinity) は "null" になるため、素で埋め込むと
  // 「有限の数値ではありません（null）」という嘘の説明になる
  assertRejects(data([ev({ id: "ev-inf", lat: Infinity, lng: 100.5 })]), "（Infinity）");
  assertRejects(data([ev({ id: "ev-nan2", lat: 13.7, lng: NaN })]), "（NaN）");
  assertRejects(data([ev({ id: "ev-nan3", start: NaN })]), "（NaN）");
});

test("id の重複を弾く", () => {
  assertRejects(data([ev(), ev()]), "重複");
});

test("id が無いイベントは配列上の位置で名指しする", () => {
  const nameless = ev();
  delete nameless.id;
  assertRejects(data([ev(), nameless]), "events[1]");
});

test("days / events の型そのものを検査する", () => {
  assertRejects({ days: DAYS, events: {} }, "events が配列ではありません");
  assertRejects({ days: "6", events: [] }, "days が配列ではありません");
  assertRejects({ days: [], events: [] }, "days が空です");
  assertRejects({ days: [{ date: "8/12" }], events: [] }, "dow");
  assert.throws(() => validateEvents(null), EventDataError);
  assert.throws(() => validateEvents([]), EventDataError);
});

test("不備は 1 件目で止めずにまとめて報告する", () => {
  assert.throws(
    () => validateEvents(data([ev({ id: "a", startDay: 9 }), ev({ id: "b", cat: "cat-x" })])),
    (error) => {
      assert.match(error.message, /2 件の不備/);
      assert.ok(error.message.includes("a") && error.message.includes("b"));
      return true;
    }
  );
});

test("不備が多いときは先頭だけ出して残りは件数で示す", () => {
  const many = Array.from({ length: 15 }, (_, i) => ev({ id: `ev-${i}`, startDay: 9 }));
  assert.throws(
    () => validateEvents(data(many)),
    (error) => {
      assert.match(error.message, /15 件の不備/);
      assert.match(error.message, /…ほか 5 件/);
      return true;
    }
  );
});
