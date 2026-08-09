import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextEventId, mergeEvent, withEvent, withoutEvent } from "../assets/js/event-editor.js";
import { readEventForm, formProblems } from "../assets/js/event-form.js";
import { validateEvents } from "../assets/js/validate.js";

const DATA = JSON.parse(
  readFileSync(new URL("../assets/data/events.json", import.meta.url), "utf8")
);

/** フォームに表示される値を id → 文字列の表にする（描画せずに読み出しを再現する）。 */
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

/** フォームを開いてタイトルだけ書き換え、保存した結果のイベントを返す。 */
function editTitle(original, title) {
  const values = { ...valuesOf(original), "f-title": title };
  return mergeEvent(original, readEventForm(getter(values)));
}

/* ── id の採番 ────────────────────────────────────────── */

test("採番した id は既存と衝突しない", () => {
  const events = [{ id: "ev-001" }, { id: "ev-002" }];
  assert.equal(nextEventId(events), "ev-003");
});

test("件数と最大値がずれていても衝突しない", () => {
  // 途中を削除したデータ。件数（2）から作る ev-003 は埋まっている
  const events = [{ id: "ev-001" }, { id: "ev-003" }];
  assert.equal(nextEventId(events), "ev-004");
});

test("実データの次の id は既存のどれとも重ならない", () => {
  const id = nextEventId(DATA.events);
  assert.ok(!DATA.events.some((ev) => ev.id === id), `${id} は既存の id と重なっています`);
  // 採番したイベントを足したデータ全体が検査を通ること（重複はここでしか出ない）
  const added = { id, ...readEventForm(getter(valuesOf({ ...DATA.events[0], allDay: false }))) };
  validateEvents(withEvent(DATA, added));
});

/* ── 併合（保存で既存の値を消さないこと） ─────────────── */

test("フォームに無い image / imagePos / icon は編集で消えない", () => {
  const original = {
    id: "ev-999",
    cat: "cat-sight",
    title: "元のタイトル",
    allDay: false,
    startDay: 0,
    endDay: 0,
    location: "",
    lat: null,
    lng: null,
    url: "",
    notes: "",
    start: 9,
    end: 10,
    image: "https://example.com/a.jpg",
    imagePos: "center 30%",
    icon: "i-boat",
  };
  const updated = editTitle(original, "直したタイトル");

  assert.equal(updated.title, "直したタイトル");
  assert.equal(updated.image, "https://example.com/a.jpg");
  assert.equal(updated.imagePos, "center 30%");
  assert.equal(updated.icon, "i-boat");
  assert.equal(updated.id, "ev-999");
});

test("併合しないと消えることを、実データで確かめる", () => {
  // ここが「なぜ mergeEvent が要るのか」。readEventForm の戻り値をそのまま
  // 保存すると、画像を持つ 24 件からキーごと image が消える。しかも
  // image は省略できる項目なので validateEvents は何も言わない
  const withImage = DATA.events.filter((ev) => ev.image);
  assert.ok(withImage.length >= 20, `画像を持つイベントが ${withImage.length} 件しかありません`);

  const naive = readEventForm(getter(valuesOf(withImage[0])));
  assert.equal("image" in naive, false);
  validateEvents({ ...DATA, events: [{ ...naive, id: withImage[0].id }] }); // 検査は通ってしまう

  const merged = mergeEvent(withImage[0], naive);
  assert.equal(merged.image, withImage[0].image);
});

test("実データのどの予定でも、タイトルだけの編集で省略項目が残る", () => {
  for (const original of DATA.events) {
    const updated = editTitle(original, `${original.title}（改）`);
    for (const key of ["image", "imagePos", "icon"]) {
      assert.equal(
        Object.hasOwn(updated, key),
        Object.hasOwn(original, key),
        `${original.id}: ${key} のキーが増減しています`
      );
      assert.equal(updated[key], original[key], `${original.id}: ${key} の値が変わっています`);
    }
    assert.equal(updated.title, `${original.title}（改）`);
    // 保存前に必ず通す全体検査を、1 件ずつ差し替えた形でも通ること
    validateEvents(withEvent(DATA, updated));
  }
});

test("併合しても id はフォームの外から変えられない", () => {
  const original = { id: "ev-001", cat: "cat-food", title: "a", allDay: true, startDay: 0, endDay: 0 };
  // フォームは id を返さないが、万一混ざっても元の id が勝つこと
  const merged = mergeEvent(original, { id: "ev-999", title: "b" });
  assert.equal(merged.id, "ev-001");
});

test("終日に切り替えると start / end が落ちる", () => {
  const original = {
    id: "ev-001", cat: "cat-hotel", title: "泊まる", allDay: false,
    startDay: 0, endDay: 0, start: 15, end: 23,
  };
  const values = { ...valuesOf(original), "f-allday": "on" };
  const merged = mergeEvent(original, readEventForm(getter(values)));

  assert.equal(merged.allDay, true);
  assert.equal("start" in merged, false, "終日なのに start が残っています");
  assert.equal("end" in merged, false, "終日なのに end が残っています");
});

test("終日から時刻ありに戻すと start / end が入る", () => {
  const original = { id: "ev-001", cat: "cat-hotel", title: "泊まる", allDay: true, startDay: 0, endDay: 0 };
  const values = { ...valuesOf(original), "f-allday": "", "f-start": "15:00", "f-end": "23:30" };
  const merged = mergeEvent(original, readEventForm(getter(values)));

  assert.equal(merged.allDay, false);
  assert.equal(merged.start, 15);
  assert.equal(merged.end, 23.5);
});

/* ── 配列の差し替え ──────────────────────────────────── */

test("差し替えは並び順を保ち、元の配列を書き換えない", () => {
  const data = { days: DATA.days, events: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const next = withEvent(data, { id: "b", title: "新" });

  assert.deepEqual(next.events.map((e) => e.id), ["a", "b", "c"]);
  assert.equal(next.events[1].title, "新");
  assert.equal(data.events[1].title, undefined, "元の配列が書き換えられています");
  assert.notEqual(next.events, data.events);
});

test("知らない id は末尾に足される", () => {
  const data = { days: DATA.days, events: [{ id: "a" }] };
  assert.deepEqual(withEvent(data, { id: "z" }).events.map((e) => e.id), ["a", "z"]);
});

test("days と updatedAt は差し替えで失われない", () => {
  const next = withEvent(DATA, { ...DATA.events[0], title: "変更" });
  assert.equal(next.days, DATA.days);
  assert.equal(next.updatedAt, DATA.updatedAt);
});

test("削除は 1 件だけ取り除く", () => {
  const next = withoutEvent(DATA, DATA.events[3].id);
  assert.equal(next.events.length, DATA.events.length - 1);
  assert.ok(!next.events.some((ev) => ev.id === DATA.events[3].id));
  assert.equal(DATA.events.length, 40, "元の配列が書き換えられています");
  validateEvents(next);
});

/* ── 全体検査が最後の砦であること ─────────────────────── */

test("formProblems は古い dayCount を信じるが、validateEvents は騙されない", () => {
  // 日程を 3 日に縮めたのに、6 日だった頃の dayCount で検査した場合
  const shrunk = { ...DATA, days: DATA.days.slice(0, 3) };
  const ev = { ...DATA.events[0], startDay: 5, endDay: 5 };
  const input = readEventForm(getter(valuesOf(ev)));

  assert.deepEqual(formProblems(input, 6), [], "古い日数では素通りするはず（前提の確認）");
  assert.throws(() => validateEvents(withEvent(shrunk, mergeEvent(ev, input))), /startDay/);
});

test("id が重複したまま保存しようとすると全体検査が止める", () => {
  const duped = { ...DATA, events: [...DATA.events, { ...DATA.events[0] }] };
  assert.throws(() => validateEvents(duped), /id が重複しています/);
});
