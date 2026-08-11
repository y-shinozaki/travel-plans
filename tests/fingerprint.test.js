/**
 * 指紋（fingerprint.js）。時計を見ない競合検出のための道具。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint } from "../assets/js/fingerprint.js";

test("同じ内容は同じ指紋になる", () => {
  const text = '{"updatedAt":"2026-08-11T00:00:00.000Z","ct":"abc"}';
  assert.equal(fingerprint(text), fingerprint(text));
});

test("1 文字違えば指紋が変わる", () => {
  assert.notEqual(fingerprint('{"ct":"abc"}'), fingerprint('{"ct":"abd"}'));
});

test("末尾の空白と改行は無視する", () => {
  // 配信されたファイルと Contents API から取った本文で改行の有無が割れると、
  // 公開が毎回 409 になる
  const base = '{"ct":"abc"}';
  assert.equal(fingerprint(base), fingerprint(`${base}\n`));
  assert.equal(fingerprint(base), fingerprint(`${base}\n\n  `));
});

test("先頭や途中の空白は無視しない", () => {
  // 末尾だけを緩めている。中身が変わったのに同じ指紋になっては意味が無い
  assert.notEqual(fingerprint('{"ct":"abc"}'), fingerprint(' {"ct":"abc"}'));
  assert.notEqual(fingerprint('{"ct":"a c"}'), fingerprint('{"ct":"ac"}'));
});

test("日本語と絵文字を含む本文でも安定する", () => {
  const text = '{"note":"パタヤ 🏖 依田家"}';
  assert.equal(fingerprint(text), fingerprint(text));
  assert.notEqual(fingerprint(text), fingerprint('{"note":"パタヤ 🏖 篠崎家"}'));
});

test("64 ビットぶんの幅がある（1 レーンに退化していない）", () => {
  // 32 ビットだと、旅程 1 本の改版を重ねるうちに偶然の一致が現実的になる
  assert.match(fingerprint("x"), /^[0-9a-f]{16}$/);
  // 2 レーンが同じ値を返していないこと（同じなら前半と後半が一致する）
  const fp = fingerprint("travel-plans");
  assert.notEqual(fp.slice(0, 8), fp.slice(8), "2 レーンが同じ値になっています");
});

test("現実的な件数でぶつからない", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    seen.add(fingerprint(`{"updatedAt":"2026-08-11T00:00:00.${String(i).padStart(3, "0")}Z"}`));
  }
  assert.equal(seen.size, 5000, "衝突しています");
});
