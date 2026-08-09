import test from "node:test";
import assert from "node:assert/strict";
import { decToHHMM, hhmmToDec, timeLabel } from "../assets/js/time.js";

test("decToHHMM は10進時間を HH:MM に変換する", () => {
  assert.equal(decToHHMM(0), "00:00");
  assert.equal(decToHHMM(12.5), "12:30");
  assert.equal(decToHHMM(9), "09:00");
  // 実データの値。0.08 * 60 = 4.8 → 5 分に丸める
  assert.equal(decToHHMM(15.08), "15:05");
  assert.equal(decToHHMM(10.58), "10:35");
});

test("decToHHMM は分が60に丸まったとき時に繰り上げる", () => {
  assert.equal(decToHHMM(9.999), "10:00");
  assert.equal(decToHHMM(23.999), "24:00");
});

test("decToHHMM は数値以外を拒否する", () => {
  assert.throws(() => decToHHMM("12:30"), TypeError);
  assert.throws(() => decToHHMM(NaN), TypeError);
  assert.throws(() => decToHHMM(undefined), TypeError);
});

test("hhmmToDec は HH:MM を10進時間に変換する", () => {
  assert.equal(hhmmToDec("00:00"), 0);
  assert.equal(hhmmToDec("12:30"), 12.5);
  assert.equal(hhmmToDec("9:05"), 9 + 5 / 60);
});

test("hhmmToDec は不正な形式を拒否する", () => {
  assert.throws(() => hhmmToDec("1230"), TypeError);
  assert.throws(() => hhmmToDec(""), TypeError);
  assert.throws(() => hhmmToDec("25:00"), RangeError);
  assert.throws(() => hhmmToDec("12:60"), RangeError);
});

test("decToHHMM と hhmmToDec は往復して一致する", () => {
  for (const s of ["00:00", "07:45", "10:35", "15:05", "23:55"]) {
    assert.equal(decToHHMM(hhmmToDec(s)), s);
  }
});

test("timeLabel は終日と時刻つきを出し分ける", () => {
  assert.equal(timeLabel({ allDay: true }), "終日");
  assert.equal(timeLabel({ start: 10.58, end: 15.08 }), "10:35 → 15:05");
});
