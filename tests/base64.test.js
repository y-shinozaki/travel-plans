import test from "node:test";
import assert from "node:assert/strict";
import { toBase64Utf8, fromBase64Utf8, toBase64Bytes, fromBase64Bytes } from "../assets/js/base64.js";
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

test("バイト列を base64 にして戻すと元に戻る", () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255, 16, 42]);
  assert.deepEqual(fromBase64Bytes(toBase64Bytes(bytes)), bytes);
});

test("空のバイト列も往復する", () => {
  assert.deepEqual(fromBase64Bytes(toBase64Bytes(new Uint8Array(0))), new Uint8Array(0));
});

test("長いバイト列でも RangeError にならない", () => {
  // String.fromCharCode(...bytes) だと引数が多すぎて落ちる長さ
  const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
  assert.deepEqual(fromBase64Bytes(toBase64Bytes(bytes)), bytes);
});

test("toBase64Bytes は Uint8Array 以外を拒む", () => {
  assert.throws(() => toBase64Bytes("あ"), TypeError);
  assert.throws(() => toBase64Bytes([1, 2, 3]), TypeError);
});

test("fromBase64Bytes は文字列以外を拒む", () => {
  assert.throws(() => fromBase64Bytes(new Uint8Array([1])), TypeError);
  assert.throws(() => fromBase64Bytes(null), TypeError);
});

test("fromBase64Utf8 は文字列以外を拒む", () => {
  // 設計書 §13 のテストの穴。toBase64Utf8 側にはあったが、こちらに無かった
  assert.throws(() => fromBase64Utf8(123), TypeError);
  assert.throws(() => fromBase64Utf8(null), TypeError);
});
