/**
 * カレンダーのブロック配置の算数。
 *
 * これまで buildBlock の中に閉じていて一度もテストされておらず、
 * maxHeight のクランプを丸ごと消しても全テストが通る状態だった。
 * DOM を必要としない計算なので blockLayout() として切り出してある。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { blockLayout, HOUR_H } from "../assets/js/calendar.js";

const layout = (over = {}) =>
  blockLayout({ start: 10, end: 11, viewStart: 6, viewEnd: 22, lane: 0, laneCount: 1, ...over });

test("HOUR_H が想定どおり（以降の期待値はこれを前提にしている）", () => {
  assert.equal(HOUR_H, 44);
});

test("表示範囲の内側にあるブロックは素直に配置される", () => {
  const r = layout({ start: 10, end: 11 });
  assert.equal(r.top, (10 - 6) * 44);
  assert.equal(r.height, 44 - 2);
  assert.equal(r.leftPct, 0);
  assert.equal(r.widthPct, 100);
});

test("viewStart より前に始まるブロックは上端で切り落とす", () => {
  // 04:00→08:00 を 06:00 始まりで見る。top が負になってはいけない
  const r = layout({ start: 4, end: 8 });
  assert.equal(r.top, 0, "top が 0 になっていません");
  assert.equal(r.height, 2 * 44 - 2, "見えている 2 時間ぶんの高さになっていません");
});

test("viewEnd より後に終わるブロックは下端で切り落とす", () => {
  // 20:00→翌 02:00 を 22:00 終わりで見る
  const r = layout({ start: 20, end: 26 });
  assert.equal(r.top, (20 - 6) * 44);
  assert.equal(r.height, 2 * 44 - 2);
  assert.equal(r.top + r.height <= (22 - 6) * 44, true, "列の下端をはみ出しています");
});

test("列の下端にある極端に短いブロックは 22px の下限より列の高さを優先する", () => {
  // 21:58:48 → 21:59:24。素の下限 22px を適用すると 21px 以上はみ出す
  const viewStart = 6;
  const viewEnd = 22;
  const totalHeight = (viewEnd - viewStart) * 44;
  const r = layout({ start: 21.98, end: 21.99, viewStart, viewEnd });

  assert.ok(r.height > 0, "高さが 0 以下になっています");
  assert.ok(r.height < 22, `下限 22px がクランプされていません（height=${r.height}）`);
  assert.ok(
    r.top + r.height <= totalHeight + 1e-9,
    `列の下端 ${totalHeight}px を ${(r.top + r.height - totalHeight).toFixed(2)}px 突き破っています`
  );
});

test("表示範囲の途中にある極端に短いブロックには 22px の下限が効く", () => {
  // 下端でないので下限を諦める理由がない。上のテストと対で、
  // クランプが「常に 22px を潰す」方向へ間違って直されるのを防ぐ
  const r = layout({ start: 10, end: 10.01 });
  assert.equal(r.height, 22);
});

test("高さ 36px を境に時刻ラベルの有無が切り替わる", () => {
  const below = layout({ start: 6, end: 6.8636 });
  const above = layout({ start: 6, end: 6.8637 });
  // 境界を 0.005px の幅で挟む。しきい値が 36 から動けばどちらかが落ちる
  assert.ok(below.height < 36 && below.height > 35.99, `height=${below.height}`);
  assert.ok(above.height >= 36 && above.height < 36.01, `height=${above.height}`);
  assert.equal(below.showTime, false, "36px 未満なのに時刻を出しています");
  assert.equal(above.showTime, true, "36px 以上なのに時刻を省いています");
});

test("下端クランプで縮んだブロックの showTime は縮んだあとの高さで決まる", () => {
  // 本来 2 時間 = 86px あるが、列の残りが 22px しかない
  const r = layout({ start: 21.5, end: 23.5, viewStart: 6, viewEnd: 22 });
  assert.equal(r.height, 22);
  assert.equal(r.showTime, false, "クランプ前の高さで判定しています");
});

test("レーンは横幅を等分し、左端をレーン番号で決める", () => {
  assert.deepEqual(
    [0, 1, 2].map((lane) => layout({ lane, laneCount: 3 })).map((r) => [r.leftPct, r.widthPct]),
    [
      [0, 100 / 3],
      [100 / 3, 100 / 3],
      [200 / 3, 100 / 3],
    ]
  );
});
