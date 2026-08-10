import test from "node:test";
import assert from "node:assert/strict";
import { EventDataError } from "../assets/js/validate.js";
import { DecryptError } from "../assets/js/crypto.js";
import { DataFetchError, DataParseError, classifyLoadError } from "../assets/js/load-error.js";

test("データ内容の不備は再読み込みを勧めない", () => {
  const { kind, message } = classifyLoadError(new EventDataError("ev-1 の startDay が範囲外です"));
  assert.equal(kind, "data");
  assert.ok(message.includes("再読み込みでは直りません"));
  assert.ok(message.includes("ev-1"));
});

test("合言葉違いは再入力へ導く", () => {
  const { kind, message } = classifyLoadError(new DecryptError("wrong-key", "別の合言葉で暗号化されています"));
  assert.equal(kind, "wrong-key");
  assert.ok(message.includes("合言葉"));
  assert.ok(message.includes("index.html"));
});

test("壊れた暗号文は合言葉のせいにしない", () => {
  const { kind, message } = classifyLoadError(new DecryptError("corrupt", "データが壊れています"));
  assert.equal(kind, "corrupt");
  // "合言葉が違います" という文字列は load-error.js のどの分岐にも存在しないので、
  // それを検査しても corrupt が wrong-key の文言に退行したことを検出できない。
  // corrupt 分岐にしか出ない文言（公開し直す案内）で見分ける
  assert.ok(message.includes("公開し直してください"));
  assert.ok(!message.includes("index.html"));
});

test("形式が壊れた暗号文も corrupt 扱いで案内する", () => {
  const { kind } = classifyLoadError(new DecryptError("malformed", "暗号文の形式が壊れています"));
  assert.equal(kind, "corrupt");
});

test("通信断は通信の話をする", () => {
  const { kind, message } = classifyLoadError(new DataFetchError("HTTP 503"));
  assert.equal(kind, "fetch");
  assert.ok(message.includes("通信状況"));
});

test("JSON の書式エラーは書式の話をする", () => {
  const { kind, message } = classifyLoadError(new DataParseError("Unexpected token", new SyntaxError("x")));
  assert.equal(kind, "parse");
  assert.ok(message.includes("書式"));
});

test("それ以外は種類と文言をそのまま見せる", () => {
  const { kind, message } = classifyLoadError(new TypeError("boom"));
  assert.equal(kind, "unknown");
  assert.ok(message.includes("TypeError"));
  assert.ok(message.includes("boom"));
});

test("null や undefined も unknown 扱いで、例外を投げずに文言を出す", () => {
  for (const value of [null, undefined]) {
    const { kind, message } = classifyLoadError(value);
    assert.equal(kind, "unknown");
    // error?.name ?? "Error" / error?.message ?? String(error) の分岐を固定する。
    // null は String(null) === "null"、undefined は String(undefined) === "undefined"
    assert.ok(message.includes("Error"));
    assert.ok(message.includes(String(value)));
  }
});

test("どの分類でも合言葉や鍵の中身は文言に載らない", () => {
  for (const error of [
    new DecryptError("wrong-key", "別の合言葉で暗号化されています"),
    new DecryptError("corrupt", "データが壊れています"),
  ]) {
    const { message } = classifyLoadError(error);
    assert.ok(!/tp:key/.test(message));
  }
});
