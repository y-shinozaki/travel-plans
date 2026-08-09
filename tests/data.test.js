/**
 * 実データ（assets/data/events.json）をパイプラインに通す。
 *
 * 個々の関数のテストは合成データで書いてあるが、実データそのものを
 * expandEvents / collectLocations / assignLanes に通すものが 1 つも無かった。
 * つまり「関数は正しいがデータが壊れた」という編集事故は誰も検知できなかった。
 *
 * 期待値は 2026-08-09 時点の内容から取った実測値。旅程を編集して数が変われば
 * ここが落ちる ── そのときは差分を確認したうえで期待値を更新すること
 * （落ちたから消す、ではなく、意図した変更かを一度見る）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expandEvents, collectLocations, hasCoords } from "../assets/js/events.js";
import { assignLanes } from "../assets/js/lanes.js";
import { validateEvents } from "../assets/js/validate.js";
import { timeLabel } from "../assets/js/time.js";

const data = JSON.parse(
  readFileSync(new URL("../assets/data/events.json", import.meta.url), "utf8")
);

test("実データが読み込み時の検査を通る", () => {
  // schedule.js が起動時に呼ぶのと同じ検査。ここが落ちるならブラウザでも
  // カレンダーが出ない（＝コミット前に気付ける）
  assert.doesNotThrow(() => validateEvents(data));
});

test("実データの件数が想定どおり", () => {
  assert.equal(data.days.length, 6, "日数");
  assert.equal(data.events.length, 43, "イベント件数");
  assert.equal(data.events.filter((e) => e.allDay).length, 5, "終日イベント");
  assert.equal(data.events.filter((e) => e.endDay > e.startDay).length, 3, "複数日イベント");
});

test("実データの全イベントがカレンダーのセグメントになる（消えるイベントが無い）", () => {
  const segments = expandEvents(data.events, data.days.length);
  const covered = new Set(segments.map((s) => s.ref.id));
  const missing = data.events.filter((e) => !covered.has(e.id)).map((e) => `${e.id}/${e.title}`);
  assert.deepEqual(missing, [], "セグメントが 1 つも作られないイベントがあります");

  // 単日 40 件 + ev-008（3 日）+ ev-009（3 日）+ ev-010（2 日）＝ 48
  assert.equal(segments.length, 48, "セグメント総数");
  for (const seg of segments) {
    assert.ok(seg.day >= 0 && seg.day < data.days.length, `${seg.ref.id}: day が範囲外`);
  }
});

test("日付をまたぐフライトは 2 日ぶんに割れる（start > end を壊さない）", () => {
  // ev-010 は 21:55 発 → 翌 06:20 着。start > end は「間違い」ではないので、
  // 正規化や入れ替えで直そうとしないこと
  const flight = data.events.find((e) => e.id === "ev-010");
  assert.ok(flight, "ev-010 がありません");
  assert.ok(flight.start > flight.end, "ev-010 が日をまたぐ形ではなくなっています");

  const segs = expandEvents([flight], data.days.length);
  assert.deepEqual(
    segs.map((s) => [s.day, s.start, s.end]),
    [
      [4, 21.92, 24],
      [5, 0, 6.33],
    ]
  );
  assert.equal(timeLabel(flight), "21:55 → 06:20");
});

test("座標を持つイベントは同一地点にまとめられる", () => {
  const withCoords = data.events.filter(hasCoords);
  assert.equal(withCoords.length, 23, "座標を持つイベント数");
  assert.equal(collectLocations(data.events, null).length, 19, "重複除去後の地点数");
});

test("カテゴリで絞ると地点が実際に減る", () => {
  const all = collectLocations(data.events, null);
  const food = collectLocations(data.events, "cat-food");
  assert.ok(food.length > 0, "cat-food の地点が 0 件です");
  assert.ok(food.length < all.length, "絞り込んでも件数が減っていません");
  assert.ok(food.every((e) => e.cat === "cat-food"));
});

test("重なり合う予定にレーンが割り当てられ、同じレーンは時間が重ならない", () => {
  const segments = expandEvents(data.events, data.days.length).filter((s) => !s.allDay);
  let maxLanes = 1;

  for (let day = 0; day < data.days.length; day++) {
    const placed = assignLanes(segments.filter((s) => s.day === day));
    for (const seg of placed) {
      assert.ok(seg.lane >= 0 && seg.lane < seg.laneCount, `day ${day}: lane が範囲外`);
      maxLanes = Math.max(maxLanes, seg.laneCount);
    }
    // 同じレーンに置かれたもの同士は重ならない
    const byLane = new Map();
    for (const seg of placed) {
      const list = byLane.get(seg.lane) ?? [];
      for (const other of list) {
        assert.ok(
          seg.start >= other.end || seg.end <= other.start,
          `day ${day} lane ${seg.lane}: ${other.ref.id} と ${seg.ref.id} が重なっています`
        );
      }
      list.push(seg);
      byLane.set(seg.lane, list);
    }
  }

  // 実データには実際に重なる予定がある。1 のままなら重なり判定が死んでいる
  assert.ok(maxLanes >= 2, `重なりが 1 件も検出されていません（maxLanes=${maxLanes}）`);
});
