/**
 * 旅程データをパイプラインに通す。
 *
 * **2026-08-10（Phase B4）で、このファイルの役割が 2 つに割れた。**
 *
 * 元は実データ（assets/data/events.json）を直接読み、検査とパイプラインに
 * 通していた。狙いは「関数は正しいがデータが壊れた」という編集事故を
 * コミット前に捕まえることだった。B4 で events.json が暗号文になったため、
 * テストからは中身を読めなくなり、その役割は成立しなくなった。
 *
 * 残っているもの:
 *
 * 1. **リポジトリのファイルが封筒の形をしていること**（下の 2 件）。
 *    中身は見られないが、「暗号化されないまま公開されていないか」は見張れる
 * 2. **パイプラインの検査**は tests/fixtures/itinerary.js の合成データで行う。
 *    expandEvents / collectLocations / assignLanes の振る舞いは守れるが、
 *    実データの編集事故は検知できない
 *
 * **失われたものを黙って忘れないこと。** 実データを機械的に検査できるのは、
 * 公開直前の validateEvents（sync.js の publish()）だけになった。壊れた旅程を
 * リポジトリへ入れない砦はそこ 1 つで、コミット前には何も動かない
 * （設計書 §13「テストの穴」に記録してある）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expandEvents, collectLocations, hasCoords } from "../assets/js/events.js";
import { assignLanes } from "../assets/js/lanes.js";
import { validateEvents } from "../assets/js/validate.js";
import { timeLabel } from "../assets/js/time.js";
import { isEnvelope } from "../assets/js/crypto.js";
import { ITINERARY as data } from "./fixtures/itinerary.js";

const publishedText = readFileSync(
  new URL("../assets/data/events.json", import.meta.url),
  "utf8"
);

test("公開されている events.json は封筒になっている", () => {
  const raw = JSON.parse(publishedText);
  assert.equal(isEnvelope(raw), true, "暗号化されないまま公開されています");
  // 外側の updatedAt は突き合わせ（assertRemoteNotAhead）が復号せずに読む。
  // これが消えると B1 の競合検出が黙って効かなくなる
  assert.equal(typeof raw.updatedAt, "string");
  assert.equal(typeof raw.kdf.salt, "string");
  assert.equal(typeof raw.kdf.iter, "number");
  assert.equal(typeof raw.iv, "string");
});

test("封筒に旅程の中身が漏れていない", () => {
  // 暗号文の外に出てよいのは updatedAt と kdf / iv だけ。
  // 実際の行き先・人名がここに現れたら、暗号化の意味が無い
  for (const word of ["スワンナプーム", "パタヤ", "バンコク", "ホテル", "依田", "篠崎", "cat-move"]) {
    assert.ok(!publishedText.includes(word), `${word} が暗号文の外に出ています`);
  }
});

test("フィクスチャが読み込み時の検査を通る", () => {
  // schedule.js が起動時に呼ぶのと同じ検査。フィクスチャ自体が旅程の形を
  // 保っていることの確認でもある（形が崩れると以降のテストが無意味になる）
  assert.doesNotThrow(() => validateEvents(data));
});

test("フィクスチャの件数が想定どおり", () => {
  assert.equal(data.days.length, 3, "日数");
  assert.equal(data.events.length, 6, "イベント件数");
  assert.equal(data.events.filter((e) => e.allDay).length, 1, "終日イベント");
  assert.equal(data.events.filter((e) => e.endDay > e.startDay).length, 2, "複数日イベント");
});

test("全イベントがカレンダーのセグメントになる（消えるイベントが無い）", () => {
  const segments = expandEvents(data.events, data.days.length);
  const covered = new Set(segments.map((s) => s.ref.id));
  const missing = data.events.filter((e) => !covered.has(e.id)).map((e) => `${e.id}/${e.title}`);
  assert.deepEqual(missing, [], "セグメントが 1 つも作られないイベントがあります");

  // 単日 4 件 + fx-004（3 日）+ fx-005（2 日）＝ 9
  assert.equal(segments.length, 9, "セグメント総数");
  for (const seg of segments) {
    assert.ok(seg.day >= 0 && seg.day < data.days.length, `${seg.ref.id}: day が範囲外`);
  }
});

test("日付をまたぐ移動は 2 日ぶんに割れる（start > end を壊さない）", () => {
  // fx-005 は 21:55 発 → 翌 06:20 着。start > end は「間違い」ではないので、
  // 正規化や入れ替えで直そうとしないこと
  const flight = data.events.find((e) => e.id === "fx-005");
  assert.ok(flight, "fx-005 がありません");
  assert.ok(flight.start > flight.end, "fx-005 が日をまたぐ形ではなくなっています");

  const segs = expandEvents([flight], data.days.length);
  assert.deepEqual(
    segs.map((s) => [s.day, s.start, s.end]),
    [
      [1, 21.92, 24],
      [2, 0, 6.33],
    ]
  );
  assert.equal(timeLabel(flight), "21:55 → 06:20");
});

test("座標を持つイベントは同一地点にまとめられる", () => {
  const withCoords = data.events.filter(hasCoords);
  // fx-004 は lat/lng が両方 null なので外れる
  assert.equal(withCoords.length, 5, "座標を持つイベント数");
  // fx-001 と fx-002 が同じ座標なので 1 地点に畳まれ、5 → 4
  assert.equal(collectLocations(data.events, null).length, 4, "重複除去後の地点数");
});

test("カテゴリを隠すと地点が実際に減る", () => {
  const all = collectLocations(data.events, null);
  // 隠すカテゴリはフィクスチャから選ぶ。名前を決め打ちすると、座標を持たない
  // カテゴリを指したときに「減らないのが正しい」のか「壊れている」のか区別できない
  const target = all[0].cat;
  const rest = collectLocations(data.events, new Set([target]));
  assert.ok(all.length > 1, "地点が 1 件では減ったことを確かめられません");
  assert.ok(rest.length < all.length, `${target} を隠しても件数が減っていません`);
  assert.ok(rest.every((e) => e.cat !== target), "隠したカテゴリが残っています");

  // 座標を持たないカテゴリを隠しても件数は変わらない（隠す対象が地点に無いだけ）
  const noCoordCat = "cat-food";
  assert.ok(
    !all.some((e) => e.cat === noCoordCat),
    "前提が変わりました: cat-food が地点を持つようになっています"
  );
  assert.equal(collectLocations(data.events, new Set([noCoordCat])).length, all.length);
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

  // フィクスチャには実際に重なる予定（fx-001 と fx-003）がある。
  // 1 のままなら重なり判定が死んでいる
  assert.ok(maxLanes >= 2, `重なりが 1 件も検出されていません（maxLanes=${maxLanes}）`);
});
