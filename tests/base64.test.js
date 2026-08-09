import test from "node:test";
import assert from "node:assert/strict";
import { toBase64Utf8, fromBase64Utf8 } from "../assets/js/base64.js";
import { readFileSync } from "node:fs";

test("ASCII を base64 にできる", () => {
  assert.equal(toBase64Utf8("hello"), "aGVsbG8=");
});

test("btoa が落ちる日本語を扱える", () => {
  // btoa("ワット") は InvalidCharacterError になる。ここが本題。
  assert.throws(() => btoa("ワット"));
  assert.equal(fromBase64Utf8(toBase64Utf8("ワット アルン")), "ワット アルン");
});

test("絵文字（サロゲートペア）が壊れない", () => {
  assert.equal(fromBase64Utf8(toBase64Utf8("🛕🇹🇭")), "🛕🇹🇭");
});

test("空文字を扱える", () => {
  assert.equal(toBase64Utf8(""), "");
  assert.equal(fromBase64Utf8(""), "");
});

test("実データの events.json が往復して一致する", () => {
  // 本番で通す当のデータで確かめる。長さもここで効く。
  const json = readFileSync(new URL("../assets/data/events.json", import.meta.url), "utf8");
  assert.equal(fromBase64Utf8(toBase64Utf8(json)), json);
});

test("長い文字列でも落ちない", () => {
  // String.fromCharCode.apply(null, bytes) 方式は引数が多いと
  // RangeError になる。ループで組み立てていればここで差が出る。
  const long = "あ".repeat(200_000);
  assert.equal(fromBase64Utf8(toBase64Utf8(long)), long);
});

test("文字列以外は拒否する", () => {
  assert.throws(() => toBase64Utf8(null), TypeError);
  assert.throws(() => toBase64Utf8({ a: 1 }), TypeError);
});
