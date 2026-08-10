/**
 * row-controls.js。packing-render.test.js と同じ最小 DOM スタブを使う。
 *
 * 見るのは「2 度押しで初めて実行する」ことと、値が innerHTML に流れないこと。
 * どちらも規約（alert/confirm を使わない・値を innerHTML に入れない）の実体。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { iconButton, armedIconButton, CHECK_MARK } from "../assets/js/row-controls.js";

function stubDocument() {
  const htmlSink = [];
  globalThis.document = {
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      style: {},
      attrs: {},
      listeners: {},
      className: "",
      set innerHTML(v) {
        htmlSink.push(String(v));
        this._html = String(v);
      },
      get innerHTML() {
        return this._html ?? "";
      },
      set textContent(v) {
        this._text = String(v);
      },
      get textContent() {
        return this._text ?? "";
      },
      setAttribute(k, v) {
        this.attrs[k] = String(v);
      },
      appendChild(c) {
        this.children.push(c);
        return c;
      },
      addEventListener(type, fn) {
        (this.listeners[type] ??= []).push(fn);
      },
      dispatch(type) {
        for (const fn of this.listeners[type] ?? []) fn();
      },
    }),
  };
  return htmlSink;
}

test("iconButton: type=button と aria-label / title を付ける", () => {
  stubDocument();
  const b = iconButton("rowbtn", "i-x", "削除");
  assert.equal(b.type, "button");
  assert.equal(b.attrs["aria-label"], "削除");
  assert.equal(b.title, "削除");
  assert.equal(b.className, "rowbtn");
});

test("iconButton: ラベルは innerHTML に流れない（アイコンの定数だけ）", () => {
  const htmlSink = stubDocument();
  const payload = '<img src=x onerror="window.__pwned=1">';
  iconButton("rowbtn", "i-x", payload);
  for (const html of htmlSink) {
    assert.ok(!html.includes(payload), `innerHTML にラベルが流れました: ${html}`);
  }
});

test("armedIconButton: 1 度目は実行しない", () => {
  stubDocument();
  let fired = 0;
  const b = armedIconButton({
    cls: "rowbtn rowbtn--del",
    armedCls: "rowbtn rowbtn--confirm",
    iconId: "i-x",
    label: "削除",
    armedLabel: "もう一度で削除",
    onConfirm: () => fired++,
  });
  b.dispatch("click");
  assert.equal(fired, 0, "1 度目で実行されました");
});

test("armedIconButton: 1 度目で見た目と読み上げが変わる", () => {
  stubDocument();
  const b = armedIconButton({
    cls: "rowbtn rowbtn--del",
    armedCls: "rowbtn rowbtn--confirm",
    iconId: "i-x",
    label: "削除",
    armedLabel: "もう一度で削除",
    onConfirm: () => {},
  });
  b.dispatch("click");
  assert.equal(b.className, "rowbtn rowbtn--confirm");
  assert.equal(b.attrs["aria-label"], "もう一度で削除", "読み上げが変わっていません");
  assert.equal(b.title, "もう一度で削除");
});

test("armedIconButton: 2 度目で実行する", () => {
  stubDocument();
  let fired = 0;
  const b = armedIconButton({
    cls: "a",
    armedCls: "b",
    iconId: "i-x",
    label: "削除",
    armedLabel: "もう一度で削除",
    onConfirm: () => fired++,
  });
  b.dispatch("click");
  b.dispatch("click");
  assert.equal(fired, 1);
});

test("CHECK_MARK: use ではなく生の path を持つ", () => {
  // icon("i-check") が返す <use> だと controls.css の
  // `.check__box svg path` が届かず、印の出ないボックスになる
  assert.match(CHECK_MARK, /<path/);
  assert.ok(!CHECK_MARK.includes("<use"), "use を使うとチェックの印が出ません");
});
