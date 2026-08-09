/**
 * 同じ日の中で時間が重なるイベントを横に並べるためのレーン割り当て。
 * laneCount はその日の最大レーン数で、全セグメントに同じ値を入れる。
 * 列幅を揃えないと、隣り合うイベントの幅がばらついて読みにくくなるため。
 */

export function assignLanes(segments) {
  const sorted = segments
    .map((s) => ({ ...s }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const laneEnds = [];
  for (const s of sorted) {
    // 終了時刻が開始時刻以下なら空いているとみなす（接するだけなら同居できる）
    let lane = laneEnds.findIndex((end) => end <= s.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.end);
    } else {
      laneEnds[lane] = s.end;
    }
    s.lane = lane;
  }

  const laneCount = Math.max(laneEnds.length, 1);
  for (const s of sorted) s.laneCount = laneCount;
  return sorted;
}
