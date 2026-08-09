/**
 * イベントの実体は1件のまま、描画のために日ごとのセグメントへ割る。
 * セグメントは ref で元のイベントを指すので、編集や削除は実体に対して行える。
 */

export function expandEvents(events, dayCount) {
  const out = [];
  for (const ev of events) {
    const first = ev.startDay;
    const last = Math.max(ev.endDay ?? first, first);
    for (let day = first; day <= last && day < dayCount; day++) {
      const isFirst = day === first;
      const isLast = day === last;
      out.push({
        ref: ev,
        day,
        allDay: !!ev.allDay,
        start: ev.allDay ? 0 : isFirst ? ev.start : 0,
        end: ev.allDay ? 24 : isLast ? ev.end : 24,
        isFirst,
        isLast,
      });
    }
  }
  return out;
}

/**
 * 地図に出せる座標を持つか。
 *
 * `!= null` だけでは足りない。NaN も Infinity も null ではないので素通りし、
 * そのまま L.marker / L.latLngBounds へ渡って地図が無言で壊れる。
 * validate.js が読み込み時に同じことを検査するが、こちらは実行経路そのものの
 * 防御なので、検査を通っていないデータが来ても崩れないようにしておく。
 */
export function hasCoords(ev) {
  return Number.isFinite(ev.lat) && Number.isFinite(ev.lng);
}

export function collectLocations(events, catFilter) {
  const seen = new Map();
  for (const ev of events) {
    if (!hasCoords(ev)) continue;
    if (catFilter && ev.cat !== catFilter) continue;
    const key = `${ev.lat},${ev.lng}`;
    if (!seen.has(key)) seen.set(key, ev);
  }
  return [...seen.values()];
}
