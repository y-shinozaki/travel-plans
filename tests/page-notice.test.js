/**
 * page-notice.js のテスト。
 *
 * packing-render.test.js と同じ最小 DOM スタブを使う。createNotices は
 * document.createElement と anchor.parentNode.insertBefore しか触らないので、
 * この 2 つだけを備えたスタブで足りる。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createNotices, createDrawLoop, REDRAW_FAILED } from "../assets/js/page-notice.js";

/** createElement だけを備えた最小スタブ。付けた属性と本文を読み出せる。 */
function stubDocument() {
  globalThis.document = {
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      attrs: {},
      className: "",
      textContent: "",
      hidden: false,
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
    }),
  };
}

/** insertBefore を記録するだけのアンカー。 */
function stubAnchor() {
  const inserted = [];
  return {
    inserted,
    anchor: { parentNode: { insertBefore: (node) => inserted.push(node) } },
  };
}

test("createNotices: message が null のうちは要素を作らない", () => {
  stubDocument();
  const { inserted, anchor } = stubAnchor();
  const { setNotice } = createNotices(anchor);

  setNotice(null);

  assert.equal(inserted.length, 0, "何も出していないのに要素が挿入されました");
});

test("createNotices: 最初の message で 1 度だけ挿入し、以降は使い回す", () => {
  stubDocument();
  const { inserted, anchor } = stubAnchor();
  const { setNotice } = createNotices(anchor);

  setNotice("1 回目");
  setNotice("2 回目");

  assert.equal(inserted.length, 1, "呼ぶたびに要素が増えています");
  assert.equal(inserted[0].textContent, "2 回目");
  assert.equal(inserted[0].hidden, false);
  assert.equal(inserted[0].className, "ferror");
});

test("createNotices: null を渡すと hidden になる（要素は残す）", () => {
  stubDocument();
  const { inserted, anchor } = stubAnchor();
  const { setNotice } = createNotices(anchor);

  setNotice("出す");
  setNotice(null);

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].hidden, true);
  assert.equal(inserted[0].textContent, "");
});

test("createNotices: setNotice は alert、setStampNotice は status", () => {
  stubDocument();
  const { inserted, anchor } = stubAnchor();
  const { setNotice, setStampNotice } = createNotices(anchor);

  setNotice("操作の失敗");
  setStampNotice("外側の食い違い");

  assert.equal(inserted[0].attrs.role, "alert");
  assert.equal(inserted[1].attrs.role, "status");
});

test("createNotices: 2 つは別の要素を使う（片方が他方を消さない）", () => {
  // safeDraw は成功のたびに setNotice(null) を呼ぶ。同じ要素を共有すると、
  // 編集モードの切り替えのような操作で outerStampMismatch の警告が黙って消える
  stubDocument();
  const { inserted, anchor } = stubAnchor();
  const { setNotice, setStampNotice } = createNotices(anchor);

  setStampNotice("外側の食い違い");
  setNotice("操作の失敗");
  setNotice(null);

  assert.equal(inserted.length, 2, "2 つの通知が同じ要素を使っています");
  assert.equal(inserted[0].textContent, "外側の食い違い", "stamp の文言が消えました");
  assert.equal(inserted[0].hidden, false);
});

test("createDrawLoop: safeDraw は draw を呼び、通知を消す", () => {
  const calls = [];
  const { safeDraw } = createDrawLoop({
    page: "test",
    draw: (...args) => calls.push(["draw", ...args]),
    setNotice: (m) => calls.push(["notice", m]),
  });

  safeDraw("なにかの操作", "focus-key");

  assert.deepEqual(calls, [
    ["draw", "focus-key"],
    ["notice", null],
  ]);
});

test("createDrawLoop: draw が投げても外へ出さず、文言を出す", () => {
  const notices = [];
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const { safeDraw } = createDrawLoop({
      page: "test",
      draw: () => {
        throw new Error("描画の中の失敗");
      },
      setNotice: (m) => notices.push(m),
    });

    safeDraw("編集モードの切り替え");
  } finally {
    console.error = original;
  }

  assert.equal(notices.length, 1);
  assert.equal(notices[0], REDRAW_FAILED("編集モードの切り替え"));
  assert.match(notices[0], /編集モードの切り替え/);
  assert.equal(errors.length, 1, "コンソールへ出していません");
});

test("createDrawLoop: details があれば console へ添える", () => {
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const { safeDraw } = createDrawLoop({
      page: "schedule",
      draw: () => {
        throw new Error("boom");
      },
      setNotice: () => {},
      details: () => ({ viewStart: 6 }),
    });
    safeDraw("表示時間帯の変更");
  } finally {
    console.error = original;
  }

  assert.deepEqual(errors[0][1], { viewStart: 6 }, "details が console に載っていません");
});

test("createDrawLoop: details が無ければ余分な引数を足さない", () => {
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const { safeDraw } = createDrawLoop({
      page: "packing",
      draw: () => {
        throw new Error("boom");
      },
      setNotice: () => {},
    });
    safeDraw("保存");
  } finally {
    console.error = original;
  }

  assert.equal(errors[0].length, 2, "メッセージとエラーの 2 つだけであるべきです");
});

test("createDrawLoop: scheduleDraw は 1 tick 送ってから描く", async () => {
  const calls = [];
  const { scheduleDraw } = createDrawLoop({
    page: "test",
    draw: () => calls.push("draw"),
    setNotice: () => {},
  });

  scheduleDraw("保存");
  assert.deepEqual(calls, [], "同期のうちに描いています（click より前に DOM が消える）");

  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ["draw"]);
});

test("createDrawLoop: 連続した予約は 1 回の描画にまとめる", async () => {
  let drawn = 0;
  const { scheduleDraw } = createDrawLoop({
    page: "test",
    draw: () => drawn++,
    setNotice: () => {},
  });

  scheduleDraw("1 回目");
  scheduleDraw("2 回目");
  scheduleDraw("3 回目");
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(drawn, 1, "予約がまとまっていません");
});

test("createDrawLoop: あとから来たフォーカス指定を優先し、undefined で消さない", async () => {
  const seen = [];
  const { scheduleDraw } = createDrawLoop({
    page: "test",
    draw: (key) => seen.push(key),
    setNotice: () => {},
  });

  scheduleDraw("追加", "sv:sv-001:name");
  scheduleDraw("保存"); // 指定なし。前の指定を消してはいけない
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(seen, ["sv:sv-001:name"]);
});

test("createDrawLoop: safeDraw は予約を取り消してから描く", async () => {
  // 取り消さないと、safeDraw のあとに予約分が走り、
  // 成功時の setNotice(null) が直前に出した文言を消す（ドラッグ失敗の経路）
  let drawn = 0;
  const { safeDraw, scheduleDraw } = createDrawLoop({
    page: "test",
    draw: () => drawn++,
    setNotice: () => {},
  });

  scheduleDraw("予約");
  safeDraw("即時");
  assert.equal(drawn, 1, "即時の描画が起きていません");

  await new Promise((r) => setTimeout(r, 0));
  assert.equal(drawn, 1, "取り消したはずの予約が走りました");
});
