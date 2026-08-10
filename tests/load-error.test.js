import test from "node:test";
import assert from "node:assert/strict";
import { EventDataError } from "../assets/js/validate.js";
import { DecryptError } from "../assets/js/crypto.js";
import {
  DataFetchError,
  DataParseError,
  classifyLoadError,
  toLoadError,
} from "../assets/js/load-error.js";
import { DataError } from "../assets/js/data-error.js";
import { PackingDataError } from "../assets/js/packing-validate.js";

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

test("DataError を継承した別のデータ不備も data として分類する", () => {
  class PackingDataError extends DataError {
    constructor(message) {
      super(message);
      this.name = "PackingDataError";
    }
  }
  const { kind, message } = classifyLoadError(new PackingDataError("項目が壊れています"), {
    noun: "持ち物リスト",
    path: "assets/data/packing.json",
  });
  assert.equal(kind, "data");
  assert.match(message, /持ち物リスト/);
  assert.match(message, /assets\/data\/packing\.json/);
  assert.match(message, /項目が壊れています/);
  assert.doesNotMatch(message, /旅程/);
});

test("noun / path を渡さなければ従来どおり旅程の文言になる", () => {
  const { message } = classifyLoadError(new EventDataError("startDay が範囲外です"));
  assert.match(message, /旅程/);
  assert.match(message, /assets\/data\/events\.json/);
});

test("取得失敗の文言も noun / path に従う", () => {
  const { kind, message } = classifyLoadError(new DataFetchError("HTTP 500"), {
    noun: "持ち物リスト",
    path: "assets/data/packing.json",
  });
  assert.equal(kind, "fetch");
  assert.match(message, /持ち物リスト/);
  assert.doesNotMatch(message, /旅程/);
});

/* ── toLoadError（sync.load() の失敗に種別を付け直す） ── */

test("toLoadError: DataError はそのまま返す", () => {
  const error = new EventDataError("旅程が壊れています");
  assert.equal(toLoadError(error), error);
});

test("toLoadError: DecryptError はそのまま返す", () => {
  // 引数は (reason, message)。既存の load-error.test.js と同じ並び
  const error = new DecryptError("wrong-key", "別の合言葉で暗号化されています");
  assert.equal(toLoadError(error), error);
});

test("toLoadError: cause が SyntaxError なら DataParseError にする", () => {
  const error = new Error("読めません", { cause: new SyntaxError("Unexpected token") });
  const out = toLoadError(error);
  assert.ok(out instanceof DataParseError);
  assert.equal(out.cause.name, "SyntaxError");
});

test("toLoadError: それ以外は DataFetchError にする", () => {
  const out = toLoadError(new Error("Failed to fetch"));
  assert.ok(out instanceof DataFetchError);
  assert.match(out.message, /Failed to fetch/);
});

test("toLoadError: Error でないものを渡しても文字列化して DataFetchError にする", () => {
  const out = toLoadError("こわれた");
  assert.ok(out instanceof DataFetchError);
  assert.match(out.message, /こわれた/);
});

test("toLoadError: 持ち物の PackingDataError も DataError として素通しする", () => {
  // schedule.js は EventDataError、packing.js は DataError で分岐していた。
  // 共通化で DataError 1 本にしたので、両方が素通しされることを固定する
  const error = new PackingDataError("持ち物が壊れています");
  assert.equal(toLoadError(error), error);
});
