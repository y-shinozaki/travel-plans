/**
 * 旅程データは時刻を10進時間で持つ（12.5 = 12:30）。
 * 表示用の文字列は保持せず、必要なときにここで生成する。
 */

export function decToHHMM(dec) {
  if (typeof dec !== "number" || !Number.isFinite(dec)) {
    throw new TypeError(`decToHHMM: 有限の数値ではありません: ${dec}`);
  }
  let h = Math.floor(dec);
  let m = Math.round((dec - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToDec(s) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!matched) {
    throw new TypeError(`hhmmToDec: HH:MM 形式ではありません: ${s}`);
  }
  const h = Number(matched[1]);
  const m = Number(matched[2]);
  if (h > 24) throw new RangeError(`hhmmToDec: 時が範囲外です: ${s}`);
  if (m > 59) throw new RangeError(`hhmmToDec: 分が範囲外です: ${s}`);
  return h + m / 60;
}

export function timeLabel(ev) {
  if (ev.allDay) return "終日";
  return `${decToHHMM(ev.start)} → ${decToHHMM(ev.end)}`;
}
