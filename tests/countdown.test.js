import test from "node:test";
import assert from "node:assert/strict";
import { daysUntil, countdownHtml } from "../assets/js/countdown.js";

const DEPARTURE = new Date("2026-08-12T00:00:00+09:00");
const DAY = 86_400_000;
const at = (offsetMs) => DEPARTURE.getTime() + offsetMs;

test("出発の 1 日前ちょうどは「あと 1 日」", () => {
  assert.equal(daysUntil(DEPARTURE, at(-DAY)), 1);
});

test("端数は切り上げる（残り 1 時間でも「あと 1 日」）", () => {
  // 「あと 0 日」だと、まだ時間があるのに終わったように読める
  assert.equal(daysUntil(DEPARTURE, at(-3_600_000)), 1);
  assert.equal(daysUntil(DEPARTURE, at(-1)), 1);
});

test("1 日と 1ms 前は「あと 2 日」", () => {
  assert.equal(daysUntil(DEPARTURE, at(-DAY - 1)), 2);
});

test("出発時刻ちょうどで 0 になる", () => {
  assert.equal(daysUntil(DEPARTURE, at(0)), 0);
});

test("出発後は負になる", () => {
  assert.equal(daysUntil(DEPARTURE, at(DAY)), -1);
  assert.equal(daysUntil(DEPARTURE, at(3 * DAY + 1)), -3);
});

test("Date でも数値でも now を受け取れる", () => {
  assert.equal(daysUntil(DEPARTURE, new Date(at(-2 * DAY))), 2);
  assert.equal(daysUntil(DEPARTURE, at(-2 * DAY)), 2);
});

test("時刻にできない値は例外にする", () => {
  assert.throws(() => daysUntil(new Date("なんでもない"), Date.now()), TypeError);
  assert.throws(() => daysUntil(DEPARTURE, NaN), TypeError);
});

/* ── 表示 ─────────────────────────────────────────────── */

test("残りがあるあいだは日数の行を出す", () => {
  assert.equal(countdownHtml(DEPARTURE, "同行者", at(-2 * DAY)), "出発まで あと 2 日<br>同行者");
});

test("出発時刻ちょうどから日数の行を消す", () => {
  // 「あと 0 日」も「あと -3 日」も出さない
  assert.equal(countdownHtml(DEPARTURE, "同行者", at(0)), "同行者");
  assert.equal(countdownHtml(DEPARTURE, "同行者", at(DAY)), "同行者");
  assert.equal(countdownHtml(DEPARTURE, "同行者", at(-1)), "出発まで あと 1 日<br>同行者");
});

test("副題は innerHTML に載るのでエスケープする", () => {
  const html = countdownHtml(DEPARTURE, '<img src=x onerror="window.__pwned=1">', at(-DAY));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
