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
  // 24 時台は "24:00" だけ。以前は h > 24 でしか見ていなかったので "24:30" が
  // 24.5 として通り、0〜24 に収まらない値がここから出ていた。
  // フォーム経路では formProblems → validateEvent が 0〜24 に制限するので
  // 保存前に弾かれるが、それはこの関数を直接呼ぶ経路を足した瞬間に消える保護
  // （設計書 §13）。範囲の約束はこの関数自身に持たせる。
  if (h === 24 && m > 0) throw new RangeError(`hhmmToDec: 24 時台は 24:00 のみです: ${s}`);
  return h + m / 60;
}

export function timeLabel(ev) {
  if (ev.allDay) return "終日";
  return `${decToHHMM(ev.start)} → ${decToHHMM(ev.end)}`;
}
