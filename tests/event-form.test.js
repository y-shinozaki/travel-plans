import test from "node:test";
import assert from "node:assert/strict";
import { emptyEvent, eventFormHtml, readEventForm, formProblems } from "../assets/js/event-form.js";
import { validateEvents } from "../assets/js/validate.js";

const DAYS = [
  { dow: "水", date: "8/12" }, { dow: "木", date: "8/13" }, { dow: "金", date: "8/14" },
];

/** フォームの初期値を id → 文字列の表にする（描画せずに読み出しを再現する） */
function valuesOf(ev) {
  return {
    "f-title": ev.title ?? "",
    "f-cat": ev.cat,
    "f-allday": ev.allDay ? "on" : "",
    "f-sday": String(ev.startDay),
    "f-eday": String(ev.endDay),
    "f-start": ev.allDay ? "" : "09:00",
    "f-end": ev.allDay ? "" : "10:30",
    "f-loc": ev.location ?? "",
    "f-lat": ev.lat == null ? "" : String(ev.lat),
    "f-lng": ev.lng == null ? "" : String(ev.lng),
    "f-url": ev.url ?? "",
    "f-notes": ev.notes ?? "",
  };
}
const getter = (values) => (id) => values[id] ?? "";

test("emptyEvent は検査を通る形を返す", () => {
  const ev = { ...emptyEvent(DAYS.length), title: "新しい予定" };
  assert.deepEqual(formProblems(ev, DAYS.length), []);
});

test("読み出した値が検査を通る", () => {
  const values = valuesOf({ ...emptyEvent(3), title: "ワット アルン" });
  const ev = readEventForm(getter(values));
  assert.deepEqual(formProblems(ev, 3), []);
  // 単体ではなく、本番と同じ入口でも通ること
  validateEvents({ updatedAt: "2026-08-09T10:00:00+09:00", days: DAYS, events: [{ ...ev, id: "ev-x" }] });
});

test("時刻が 10 進数に変換される", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-start": "10:35", "f-end": "15:05" };
  const ev = readEventForm(getter(values));
  assert.equal(ev.start, 10 + 35 / 60);
  assert.equal(ev.end, 15 + 5 / 60);
});

test("終日なら start / end を持たない", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-allday": "on" };
  const ev = readEventForm(getter(values));
  assert.equal("start" in ev, false);
  assert.equal("end" in ev, false);
  assert.equal(ev.allDay, true);
});

test("日をまたぐ予定は end < start でも妥当", () => {
  // 8/12 15:00 → 8/14 11:00 のホテル滞在。入れ替えて「直さない」こと
  const values = {
    ...valuesOf(emptyEvent(3)),
    "f-title": "バンコクホテル", "f-sday": "0", "f-eday": "2",
    "f-start": "15:00", "f-end": "11:00",
  };
  assert.deepEqual(formProblems(readEventForm(getter(values)), 3), []);
});

test("同じ日で終了が開始以前なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-start": "14:00", "f-end": "13:00" };
  const problems = formProblems(readEventForm(getter(values)), 3);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /終了/);
});

test("タイトルが空なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-title": "  " };
  assert.match(formProblems(readEventForm(getter(values)), 3).join(), /タイトル/);
});

test("終了日が開始日より前なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-sday": "2", "f-eday": "0" };
  assert.match(formProblems(readEventForm(getter(values)), 3).join(), /終了日/);
});

test("座標は両方揃ったときだけ採る", () => {
  const only = { ...valuesOf(emptyEvent(3)), "f-lat": "13.74", "f-lng": "" };
  const ev = readEventForm(getter(only));
  assert.equal(ev.lat, null);
  assert.equal(ev.lng, null);
  assert.deepEqual(formProblems(ev, 3), []);
});

test("両方揃えば数値として採る", () => {
  const both = { ...valuesOf(emptyEvent(3)), "f-lat": "13.74", "f-lng": "100.49" };
  const ev = readEventForm(getter(both));
  assert.equal(ev.lat, 13.74);
  assert.equal(ev.lng, 100.49);
});

test("座標が数値でなければ問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-lat": "あ", "f-lng": "100" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /緯度/);
});

test("緯度の範囲外は問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-lat": "999", "f-lng": "100" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /緯度/);
});

test("http でない URL は問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-url": "javascript:alert(1)" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /URL/);
});

test("空の URL は許す", () => {
  assert.deepEqual(formProblems(readEventForm(getter(valuesOf(emptyEvent(3)))), 3), []);
});

test("前後の空白は落とす", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-title": "  ワット  ", "f-loc": " BKK " };
  const ev = readEventForm(getter(values));
  assert.equal(ev.title, "ワット");
  assert.equal(ev.location, "BKK");
});

test("フォームの HTML がタイトルをエスケープする", () => {
  const ev = { ...emptyEvent(3), title: '<img src=x onerror="alert(1)">' };
  const html = eventFormHtml(ev, DAYS);
  assert.doesNotMatch(html, /<img\s+src=x/);
  assert.doesNotMatch(html, /onerror="/);
});

test("フォームの HTML に全カテゴリの選択肢がある", () => {
  const html = eventFormHtml(emptyEvent(3), DAYS);
  for (const cat of ["cat-move", "cat-sight", "cat-food", "cat-hotel", "cat-shop"]) {
    assert.ok(html.includes(cat), `${cat} の選択肢がありません`);
  }
});

test("フォームの HTML に日数ぶんの選択肢がある", () => {
  const html = eventFormHtml(emptyEvent(3), DAYS);
  for (const d of DAYS) assert.ok(html.includes(d.date), `${d.date} の選択肢がありません`);
});
