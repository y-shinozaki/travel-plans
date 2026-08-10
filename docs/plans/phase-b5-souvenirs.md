# Phase B5: ページ共通部品の抽出とお土産リスト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `schedule.js` と `packing.js` に重複している「失敗を画面に出す」経路を共通部品へ抽出し、その上に 3 ページ目としてお土産リスト（何を・誰に・どこで買うか）を作る。

**Architecture:** 前半（Task 1〜2）は既存 2 ページの振る舞いを一切変えない抽出。後半（Task 3〜9）は `packing.html` と同じ層構造 ── 純粋なデータ操作（`souvenirs-data.js`）／検査（`souvenirs-validate.js`）／描画（`souvenirs-render.js`）／エントリポイント（`souvenirs.js`）に分け、`node --test` が触れないのはエントリポイントだけにする。保存と公開は既存の `sync.js` / `publish-ui.js` をそのまま使い、6 つの注入口を全部渡す。

**Tech Stack:** バニラ JS（ES モジュール）、依存パッケージゼロ、ビルドなし。テストは `node --test`。

## Global Constraints

設計書 `docs/spec/travel-plans-redesign.md` と `CLAUDE.md` の規約。**全タスクに暗黙で掛かる。**

- **色・余白・角丸・モーションは `assets/css/tokens.css` の変数のみ。** CSS に 16 進数の色リテラルを書かない。半透明が要るなら `rgb(var(--ink-rgb) / 0.06)` の形を使う
- **値を `innerHTML` に入れない。** 文字は `el()`（`textContent`）で入れる。`innerHTML` に入れてよいのは `icon()` が返す定数だけ。URL は `dom.js` の `safeHttpUrl()` を通す
- **`alert()` / `confirm()` / `prompt()` を使わない。** 削除は 1 度目で身構え、2 度目で実行するボタン
- **インライン `<script>` を書かない**（CSP が `script-src 'self'`）。`on*` 属性も書かない
- **`localStorage` のキー名を 2 か所に書かない。** `tp:souvenirs` / `tp:souvenirs-base` を知ってよいのは `souvenirs.js` だけ
- **`createSync()` には 6 つの注入口を全部渡す**（`draftKey` / `baseKey` / `validate` / `commitMessage` / `codec` / `noun`）。一部だけ渡すと他ページの下書きが黙って消える
- **`createPublishUI()` には `content: { validate, noun }` を組で渡す**
- **トークンと合言葉を画面にも例外文にも出さない**
- **エントリポイントは本体を `try` / `catch` / `finally` で囲み、`initReveal()` を必ず走らせる**（`.reveal` は `opacity: 0` で待機しているため、飛ばすとページが真っ白になる）
- 各タスクの最後に `node --test` を全件流す。**着手時点は 489 pass / 0 fail**

---

## ファイル構成

**新規作成**

| ファイル | 責務 |
|---|---|
| `assets/js/page-notice.js` | `createNotices()` / `createDrawLoop()`。3 ページが共有する「失敗を画面に出す」経路と再描画の予約制 |
| `assets/js/focus-key.js` | フォーカスキーの書式。組み立てる側と `querySelector` する側が同じ関数を呼ぶための継ぎ目つぶし |
| `assets/js/row-controls.js` | 一覧の行のボタン部品（`iconButton` / `armedIconButton` / `CHECK_MARK`）。持ち物とお土産が共有 |
| `assets/js/souvenirs-data.js` | お土産データの純粋操作。DOM も store も知らない |
| `assets/js/souvenirs-validate.js` | `validateSouvenirs()` と `SouvenirDataError` |
| `assets/js/souvenirs-render.js` | 進捗と表の描画 |
| `assets/js/souvenirs.js` | `souvenirs.html` のエントリポイント |
| `assets/css/souvenirs.css` | `souvenirs.html` 専用 |
| `souvenirs.html` | ページ本体 |
| `tests/fixtures/souvenirs.js` | テスト用の合成データ |
| `tests/page-notice.test.js` / `focus-key.test.js` / `row-controls.test.js` / `souvenirs-data.test.js` / `souvenirs-validate.test.js` / `souvenirs-render.test.js` | 上記のテスト |

**変更**

| ファイル | 変更 |
|---|---|
| `assets/js/load-error.js` | `toLoadError()` を追加 |
| `assets/js/schedule.js` | 通知・`safeDraw`・失敗分類を共通部品へ差し替え |
| `assets/js/packing.js` | 同上。フォーカスキーを `focus-key.js` 経由に |
| `assets/js/packing-render.js` | フォーカスキーを `focus-key.js` 経由に。ボタン部品を `row-controls.js` へ移す |
| `assets/js/menu.js` | カード 3 枚目 |
| `assets/js/nav.js` | ページ 3 つ目 |
| `tests/csp.test.js` | `PAGES` に `souvenirs.html` |
| `tests/tokens.test.js` | 色リテラル検査の対象に `souvenirs.css` |
| `tests/renderers.test.js` | `renderNav` の期待値 |
| `tests/load-error.test.js` | `toLoadError()` のテスト |
| `CLAUDE.md` / `README.md` / `docs/README.md` / `docs/handoff/2026-08-10.md` | 記述の更新 |

---

## Task 1: 通知と再描画の共通部品を抜き出す

**Files:**
- Create: `assets/js/page-notice.js`
- Create: `tests/page-notice.test.js`
- Modify: `assets/js/load-error.js`（末尾に `toLoadError()` を追加）
- Modify: `tests/load-error.test.js`（末尾にテストを追加）
- Modify: `assets/js/schedule.js:101-163`（`safeDraw` / `setNotice` / `setStampNotice`）と `assets/js/schedule.js:368-371`（失敗分類）
- Modify: `assets/js/packing.js`（同じ 3 関数と失敗分類）

**Interfaces:**
- Produces:
  - `createNotices(anchor: Element) => { setNotice(message: string|null): void, setStampNotice(message: string|null): void }`
  - `createDrawLoop({ page: string, draw: Function, setNotice: Function, details?: () => object }) => { safeDraw(context, focusKeyOverride?), scheduleDraw(context, focusKeyOverride?) }`
  - `REDRAW_FAILED(context: string) => string`
  - `toLoadError(error: Error) => Error`（投げずに返す。呼び出し側が `throw toLoadError(e)` と書く）

**背景（この抽出が必要な理由）**

`setNotice` / `setStampNotice` は 2 ページに全文コピーされていて、**違うのはアンカー要素だけ**（`els.cal` / `els.table`）。失敗分類の 4 行は `EventDataError` か `DataError` かの違いしかなく、**`EventDataError` は `DataError` を継承しているので `DataError` 1 本で足りる**。`safeDraw` は console へ添える情報が各ページ固有だが、**画面に出す文言は完全に一致**しており、そこが割れると片方のページだけ違うことを言い出す。設計書 §13 を参照。

**予約制（`scheduleDraw`）も一緒に抱える**（2026-08-10、着手前のレビューで決定）。当初の計画は `safeDraw` だけを抜き、38 行の予約制の塊を `packing.js` と `souvenirs.js` に複製する形だった。あの塊のコメントは **`node --test` では絶対に捕まえられない不具合**の修正内容そのもの（入力欄の `change` が `mousedown` の処理中に発火する話。設計書 §13）で、複製すると次の人が片方だけ直して、もう片方が黙って壊れる。予約の取り消しを `safeDraw` の内側に閉じ込めれば、呼ぶ側は順序を気にしなくてよくなる。

- [ ] **Step 1: `tests/page-notice.test.js` を書く（失敗する状態で）**

```javascript
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
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node --test tests/page-notice.test.js`
Expected: FAIL（`Cannot find module '../assets/js/page-notice.js'`）

- [ ] **Step 3: `assets/js/page-notice.js` を書く**

```javascript
/**
 * ページが「失敗した」と伝えるための共通部品。
 *
 * schedule.js と packing.js が setNotice / setStampNotice / safeDraw を
 * 全文コピーで持っていた（設計書 §13）。違っていたのはアンカー要素と、
 * console へ添える情報だけで、**画面に出す文言は完全に一致していた** ──
 * そこが割れると、同じ失敗を片方のページだけ違う言葉で説明することになる。
 *
 * DOM は触るが document を모듈冒頭で参照しないので、createElement だけを
 * 備えたスタブがあれば node --test から呼べる（tests/page-notice.test.js）。
 */

/**
 * アンカー要素の直前に差し込む、一行の通知を 2 つ作る。
 *
 * **2 つは必ず別の要素を使う。** safeDraw は再描画に成功するたびに
 * setNotice(null) を呼ぶので、同じ要素を共有すると、編集モードの切り替えや
 * 表示時間帯の変更といった操作で setStampNotice の警告が黙って消える。
 * 封筒の外側の updatedAt の食い違い（setStampNotice が出すもの）は操作の
 * 成否とは無関係な事実で、次に公開して外側が上書きされるまで出続けるべきもの。
 *
 * アンカー本体は潰さないので、再描画に失敗しても直前まで見えていた内容は残る。
 *
 * @param {Element} anchor この要素の直前に差し込む（カレンダー本体・表本体）
 * @returns {{setNotice: (m: string|null) => void, setStampNotice: (m: string|null) => void}}
 */
export function createNotices(anchor) {
  const make = (role) => {
    let node = null;
    return (message) => {
      if (!message && !node) return;
      if (!node) {
        node = document.createElement("p");
        node.className = "ferror";
        node.setAttribute("role", role);
        anchor.parentNode.insertBefore(node, anchor);
      }
      node.textContent = message ?? "";
      node.hidden = !message;
    };
  };
  // alert は操作の失敗（今すぐ読ませたい）、status は事実の通知（割り込まない）
  return { setNotice: make("alert"), setStampNotice: make("status") };
}

/**
 * 再描画の失敗を伝える文言。**読み込み失敗（classifyLoadError）とは別の言葉にする** ──
 * データは取れているのに操作に反応しなかった、という別の状況なので、
 * 「再読み込み」を勧めるのは誤り。
 */
export const REDRAW_FAILED = (context) =>
  `表示の更新に失敗しました（${context}）。` +
  "直前の表示のまま止まっています。原因はブラウザのコンソールを確認してください。";

/**
 * 初回描画のあとの再描画を、即時（safeDraw）と予約（scheduleDraw）の 2 つの口で包む。
 *
 * main() の try/catch が守るのは最初の draw() だけで、セレクトの change や
 * ボタンの click から呼ばれる draw() は素通しになる。そこで落ちると画面は
 * 前回の描画を半分だけ残した状態で止まり、利用者には何も伝わらない。
 *
 * **なぜ予約が要るか（設計書 §13。node --test では捕まえられない不具合）**
 *
 * 入力欄の change は blur の最中に発火する ── つまり、利用者がボタンを押した
 * mousedown の処理の**途中**で起きる。そこで表を replaceChildren すると:
 *
 * 1. 押しかけていたボタンが mouseup より前に文書から消え、**click が発火しない**。
 *    名前を打ってすぐ「追加」を押しても増えず、画面には何も出ない
 *    （2 度押せば動くので、かえって原因が分かりにくい）
 * 2. ブラウザが移そうとしていたフォーカス先も消えるので document.activeElement は
 *    <body> になり、描画側がキーを拾えずフォーカスが落ちたままになる
 *
 * 描画を 1 tick 送れば両方が消える。**microtask では足りない** ──
 * blur → change は mousedown の既定動作の中なので、queueMicrotask は
 * mouseup より前に走ってしまう。
 *
 * **予約の取り消しは safeDraw の内側に閉じ込めてある。** 呼ぶ側が順序を
 * 気にしなくてよくするため ── 取り消さずに即時描画すると、そのあとに予約分が
 * 走り、成功時の setNotice(null) が直前に出した文言を消す。
 *
 * 予約が要らないページ（schedule.html）は safeDraw だけを取り出して使う。
 *
 * @param {object} args
 * @param {string} args.page console に出す接頭辞（"schedule" / "packing" / "souvenirs"）
 * @param {Function} args.draw 描画本体。第 1 引数にフォーカスキーの指定が渡る
 * @param {Function} args.setNotice createNotices() の setNotice
 * @param {() => object} [args.details] 失敗時に console へ添える状態
 * @returns {{safeDraw: Function, scheduleDraw: Function}}
 */
export function createDrawLoop({ page, draw, setNotice, details }) {
  let timer = null;
  let pendingContext = "";
  let pendingOverride = null;

  function cancelPending() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    pendingOverride = null;
  }

  /** 今すぐ描く。予約があれば捨てる。 */
  function safeDraw(context, focusKeyOverride) {
    cancelPending();
    try {
      draw(focusKeyOverride);
      setNotice(null);
    } catch (error) {
      // details が無いときに undefined を足さない（テストが引数の本数を見ている）
      const extra = details ? [details()] : [];
      console.error(`${page}: 再描画に失敗しました（${context}）`, ...extra, error);
      setNotice(REDRAW_FAILED(context));
    }
  }

  /**
   * 1 tick 送ってから描く。連続した変更（改名の直後に追加、など）は
   * 1 回の描画にまとめる ── まとめないと、先に予約した描画が新しい
   * フォーカス指定を上書きしてしまう。
   */
  function scheduleDraw(context, focusKeyOverride) {
    pendingContext = context;
    // あとから来た指定を優先する。undefined で上書きして消さないこと
    if (focusKeyOverride) pendingOverride = focusKeyOverride;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      const override = pendingOverride;
      pendingOverride = null;
      safeDraw(pendingContext, override);
    }, 0);
  }

  return { safeDraw, scheduleDraw };
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test tests/page-notice.test.js`
Expected: PASS（13 件）

- [ ] **Step 5: `toLoadError()` のテストを `tests/load-error.test.js` の末尾に足す**

```javascript
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
```

テストファイル冒頭の import に次を足す:

```javascript
import { toLoadError } from "../assets/js/load-error.js";
import { EventDataError } from "../assets/js/validate.js";
import { PackingDataError } from "../assets/js/packing-validate.js";
```

（`DecryptError` / `DataParseError` / `DataFetchError` は既に import 済みかを確認し、無ければ足す。）

- [ ] **Step 6: 落ちることを確かめる**

Run: `node --test tests/load-error.test.js`
Expected: FAIL（`toLoadError is not a function`）

- [ ] **Step 7: `assets/js/load-error.js` の末尾に `toLoadError()` を足す**

```javascript
/**
 * `sync.load()` が投げたものに種別を付け直す。**投げずに返す** ──
 * 呼び出し側が `throw toLoadError(error)` と書けば、この関数自体は
 * 純粋関数のまま node --test から呼べる。
 *
 * 失敗は「取りに行けなかった」「JSON として読めなかった」「中身がその
 * データの形になっていない」「復号できなかった」の 4 種類で、直し方が
 * それぞれ違う。classifyLoadError() が案内を出し分けられるよう、ここで
 * 種別を確定させる（JSON の解釈失敗だけは cause が SyntaxError になる）。
 *
 * **DataError で見ること。** schedule.js は EventDataError、packing.js は
 * DataError で分岐していたが、EventDataError も PackingDataError も
 * DataError を継承しているので、基底 1 本で両方を拾える（設計書 §13）。
 */
export function toLoadError(error) {
  if (error instanceof DataError) return error;
  if (error instanceof DecryptError) return error;
  if (error?.cause instanceof SyntaxError) {
    return new DataParseError(error.message, error.cause);
  }
  return new DataFetchError(error?.message ?? String(error));
}
```

- [ ] **Step 8: 通ることを確かめる**

Run: `node --test tests/load-error.test.js`
Expected: PASS

- [ ] **Step 9: `assets/js/schedule.js` を共通部品へ差し替える**

`import` に足す:

```javascript
import { createNotices, createDrawLoop } from "./page-notice.js";
import { classifyLoadError, toLoadError } from "./load-error.js";
```

`classifyLoadError, DataFetchError, DataParseError` の import 行から、使わなくなった `DataFetchError` / `DataParseError` を外す。**`EventDataError` の import も、`validateEvents` だけを使う形に減らせるなら減らす**（他で使っていないことを `grep -n "EventDataError" assets/js/schedule.js` で確かめてから）。

`safeDraw` / `setNotice` / `setStampNotice` の 3 つの関数定義（`assets/js/schedule.js:101-163`、JSDoc を含む）を削除し、次に置き換える:

```javascript
/**
 * 通知は 2 つとも page-notice.js が作る（設計書 §13 の重複の抽出）。
 * カレンダー本体（els.cal）の直前に差し込むので、再描画に失敗しても
 * 直前まで見えていた内容はそのまま残る。
 */
const { setNotice, setStampNotice } = createNotices(els.cal);

/**
 * 初回描画のあとの再描画。どの操作で、どの状態で失敗したかは console へ出す。
 * 文言は page-notice.js が持つ（3 ページで同じことを言うため）。
 */
// このページに予約は要らない（入力欄の change の最中に一覧を作り直す経路が
// 無い ── 予定の編集はシートを開いて保存する形。設計書 §13）。safeDraw だけ取る
const { safeDraw } = createDrawLoop({
  page: "schedule",
  draw,
  setNotice,
  details: () => ({
    viewStart: state.viewStart,
    viewEnd: state.viewEnd,
    hidden: [...state.hiddenCats],
  }),
});
```

失敗分類の 4 行（`assets/js/schedule.js:368-371` 付近）を 1 行にする:

```javascript
    // 失敗の種別は toLoadError() が付ける（load-error.js。設計書 §13）
    throw toLoadError(error);
```

- [ ] **Step 10: `assets/js/packing.js` を共通部品へ差し替える**

`import` に足す:

```javascript
import { createNotices, createDrawLoop } from "./page-notice.js";
```

`classifyLoadError, DataFetchError, DataParseError` の import を `classifyLoadError, toLoadError` に変える。`DataError` / `DecryptError` の import は `apply()` が `DataError` を使っているので **`DataError` は残す**。`DecryptError` が他で使われていなければ外す（`grep -n "DecryptError" assets/js/packing.js` で確認）。

`setNotice` / `setStampNotice` の関数定義と `let noticeEl` / `let stampNoticeEl` を削除し、置き換える:

```javascript
/**
 * 通知は 2 つとも page-notice.js が作る（設計書 §13 の重複の抽出）。
 * 表本体（els.table）の直前に差し込む。
 */
const { setNotice, setStampNotice } = createNotices(els.table);
```

**`safeDraw` と `scheduleDraw` の両方を削除する。** `let drawTimer` / `let drawContext` / `let drawOverride` の 3 つの宣言と、`/* ── 再描画の予約 ── */` から始まるコメントブロックごと消し、次の 2 行に置き換える:

```javascript
/**
 * 即時（safeDraw）と予約（scheduleDraw）の 2 つの口。予約が要る理由と、
 * 予約の取り消しが safeDraw の内側にある理由は page-notice.js を参照
 * （設計書 §13。node --test では捕まえられない不具合の修正なので、
 * あの記述を消さないこと）。
 */
const { safeDraw, scheduleDraw } = createDrawLoop({ page: "packing", draw, setNotice });
```

**移したコメントを捨てないこと。** 予約制の理由（`mousedown` の途中で `change` が
発火する話）は `page-notice.js` の `createDrawLoop` の JSDoc に全文が入っている。
このタスクで `packing.js` から消える 38 行は、**移動であって削除ではない**。

**ファイル内の順序を確かめること。** `const` は関数宣言と違って巻き上がらないので、次の順に並んでいる必要がある:

1. `const els = { ... }`
2. `const { setNotice, setStampNotice } = createNotices(els.table);`
3. `function draw(...)` の宣言（関数宣言なので巻き上がるが、読む順として）
4. `const { safeDraw, scheduleDraw } = createDrawLoop({ ... });`

`createDrawLoop` の呼び出しが `setNotice` の宣言より前にあると `ReferenceError`（TDZ）で**ページが真っ白**になる。`node --test` では捕まらないので、Step 12 のブラウザ確認が唯一の網。

`draw()` の中のドラッグの `onError` が `safeDraw(...)` → `setNotice(...)` の順で呼んでいる箇所はそのまま残す（順序に意味がある。`safeDraw` の成功時 `setNotice(null)` を、あとから上書きしている）。

失敗分類の 4 行を 1 行にする:

```javascript
    throw toLoadError(error);
```

- [ ] **Step 11: 全テストを流す**

Run: `node --test`
Expected: PASS。**件数は 489 + 19 = 508**（page-notice 13 件、load-error 6 件）

- [ ] **Step 12: ブラウザで 2 ページの退行が無いことを確かめる**

```bash
python3 -m http.server 8000
```

`http://localhost:8000` を開き、合言葉を入れて次を確認する（**この 2 ページはエントリポイントなのでテストが無く、ここが唯一の網**）:

1. 旅程ページ: 表示時間帯のセレクトを変える → カレンダーが描き直され、エラーが出ない
2. 旅程ページ: カテゴリチップを押す → 絞り込みが効く
3. 持ち物ページ: 「リストを編集」→ 項目名を打って **すぐに**「項目を追加」を押す → 項目が 1 度で増える（`scheduleDraw` の退行チェック。設計書 §13）
4. 持ち物ページ: 追加した直後、新しい行の名前欄にフォーカスがある

- [ ] **Step 13: コミット**

```bash
git add assets/js/page-notice.js assets/js/load-error.js assets/js/schedule.js assets/js/packing.js tests/page-notice.test.js tests/load-error.test.js
git commit -m "Give the two pages one place to say that something broke"
```

---

## Task 2: 2 つ目のページが写すことになる継ぎ目をつぶす（フォーカスキーと行コントロール）

**Files:**
- Create: `assets/js/focus-key.js`
- Create: `assets/js/row-controls.js`
- Create: `tests/focus-key.test.js`
- Create: `tests/row-controls.test.js`
- Modify: `assets/js/packing-render.js`（キー文字列 12 か所と、ボタン部品の定義 3 つ）
- Modify: `assets/js/packing.js`（`onAddItem` / `addGroup` の 2 か所）

**Interfaces:**
- Produces:
  - `itemFocusKey(id: string, field: string) => string` — `item:<id>:<field>`
  - `groupFocusKey(id: string, field: string) => string` — `group:<id>:<field>`
  - `souvenirFocusKey(id: string, field: string) => string` — `sv:<id>:<field>`
  - `iconButton(cls: string, iconId: string, label: string) => HTMLButtonElement`
  - `armedIconButton({ cls, armedCls, iconId, label, armedLabel, onConfirm }) => HTMLButtonElement`
  - `CHECK_MARK: string`（生の SVG。定数）

**このタスクが 2 つを一緒に扱う理由**

どちらも「2 つ目のページが書き写すことになる小さな共有物」で、写した瞬間に**片方だけ直せてしまう**状態が生まれる。3 つ目ができてから直すより安い、という Task 1 と同じ判断（2026-08-10、着手前のレビューで `row-controls.js` を追加）。

**背景 1: フォーカスキー**

`item:<id>:name` という書式が `packing-render.js`（組み立てる側）と `packing.js`（`querySelector` する側）に独立して書かれている。**片方だけ書式を変えても例外は出ない** ── `querySelector` が何も見つけず、フォーカスが静かに `<body>` へ落ちるだけになる。まさにこの逸脱を潰すために足した仕掛けが、同じ壊れ方で無効になる（設計書 §13）。お土産ページも同じ経路を持つので、いま潰さないと 3 か所目ができる。

**背景 2: 行コントロール**

`iconButton` と `armedIconButton` は `packing-render.js` にしかない。お土産ページも「✕ を 1 度目で身構え、2 度目で実行する」削除ボタンを持つので、写すと**「`confirm()` を使わない」という規約の実体が 2 か所に分かれる**。`CHECK_MARK`（生の SVG）はさらに悪く、**すでに 3 か所**（`packing-render.js` / `event-form.js:126` / `aman-mock.html:2487`）にあり、`packing-render.js` のコメント自身がそれを問題として記録している。4 か所目を作らない。

- [ ] **Step 1: `tests/focus-key.test.js` を書く**

```javascript
/**
 * フォーカスキーの書式。
 *
 * 値そのものより「組み立てる側と引く側が同じ関数を呼ぶ」ことが目的なので、
 * テストは書式を固定するだけでよい。ここが変わったら両側が一緒に変わる。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { itemFocusKey, groupFocusKey, souvenirFocusKey } from "../assets/js/focus-key.js";

test("itemFocusKey: item:<id>:<field>", () => {
  assert.equal(itemFocusKey("it-001", "name"), "item:it-001:name");
});

test("groupFocusKey: group:<id>:<field>", () => {
  assert.equal(groupFocusKey("g-001", "up"), "group:g-001:up");
});

test("souvenirFocusKey: sv:<id>:<field>", () => {
  assert.equal(souvenirFocusKey("sv-001", "shop"), "sv:sv-001:shop");
});

test("3 つの接頭辞は重ならない（同じ id でも別のキーになる）", () => {
  // 区分 id と項目 id は別の名前空間なので、"x" が両方に存在しうる
  const keys = new Set([
    itemFocusKey("x", "name"),
    groupFocusKey("x", "name"),
    souvenirFocusKey("x", "name"),
  ]);
  assert.equal(keys.size, 3, "接頭辞が衝突しています");
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node --test tests/focus-key.test.js`
Expected: FAIL（`Cannot find module`）

- [ ] **Step 3: `assets/js/focus-key.js` を書く**

```javascript
/**
 * 再描画のあとにフォーカスを戻すためのキーの書式。
 *
 * **組み立てる側と querySelector する側が、必ずこの関数を通ること。**
 * 書式を 2 か所に書くと、片方だけ変えても例外は出ず、フォーカスが静かに
 * <body> へ落ちるだけになる ── フォーカスを守るための仕掛けが、
 * 同じ壊れ方で無効になる（設計書 §13）。
 *
 * 位置ではなく id から作る。位置から作ると、並べ替えたその瞬間に
 * 「動いた」という事実そのものでキーが変わってしまう。
 */
const key = (kind) => (id, field) => `${kind}:${id}:${field}`;

/** 持ち物の項目。区分をまたいで一意な id を使う。 */
export const itemFocusKey = key("item");

/** 持ち物の区分。項目とは別の名前空間なので接頭辞で分ける。 */
export const groupFocusKey = key("group");

/** お土産の 1 行（Phase B5）。 */
export const souvenirFocusKey = key("sv");
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test tests/focus-key.test.js`
Expected: PASS（4 件）

- [ ] **Step 5: `packing-render.js` を関数経由に差し替える**

import に足す:

```javascript
import { itemFocusKey, groupFocusKey } from "./focus-key.js";
```

テンプレートリテラルを置き換える（**10 か所**。`grep -n 'focusKey = `' assets/js/packing-render.js` で数を確かめてから）:

| 現在 | 置き換え後 |
|---|---|
| `` `item:${item.id}:check:${member}` `` | `itemFocusKey(item.id, \`check:${member}\`)` |
| `` `item:${item.id}:name` `` | `itemFocusKey(item.id, "name")` |
| `` `item:${item.id}:note` `` | `itemFocusKey(item.id, "note")` |
| `` `item:${item.id}:place` `` | `itemFocusKey(item.id, "place")` |
| `` `item:${item.id}:up` `` | `itemFocusKey(item.id, "up")` |
| `` `item:${item.id}:down` `` | `itemFocusKey(item.id, "down")` |
| `` `item:${item.id}:del` `` | `itemFocusKey(item.id, "del")` |
| `` `group:${group.id}:name` `` | `groupFocusKey(group.id, "name")` |
| `` `group:${group.id}:up` `` | `groupFocusKey(group.id, "up")` |
| `` `group:${group.id}:down` `` | `groupFocusKey(group.id, "down")` |
| `` `group:${group.id}:del` `` | `groupFocusKey(group.id, "del")` |
| `` `group:${group.id}:add` `` | `groupFocusKey(group.id, "add")` |

- [ ] **Step 6: `packing.js` の 2 か所を差し替える**

import に足す:

```javascript
import { itemFocusKey, groupFocusKey } from "./focus-key.js";
```

`onAddItem` の `` `item:${id}:name` `` を `itemFocusKey(id, "name")` に、`addGroup` の click ハンドラの `` `group:${id}:name` `` を `groupFocusKey(id, "name")` に置き換える。

- [ ] **Step 6b: `tests/row-controls.test.js` を書く**

```javascript
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
```

- [ ] **Step 6c: 落ちることを確かめる**

Run: `node --test tests/row-controls.test.js`
Expected: FAIL（`Cannot find module`）

- [ ] **Step 6d: `assets/js/row-controls.js` を書く**

`packing-render.js` から `iconButton` / `armedIconButton` / `CHECK_MARK` を**コメントごと**移す（複製ではなく移動）。

```javascript
/**
 * 一覧の行に置くコントロール。持ち物とお土産の両方が使う。
 *
 * ここに集めてあるのは、**写すと規約の実体が 2 か所に分かれるもの**:
 * 「1 度目で身構え、2 度目で実行する」は `confirm()` を使わないという規約
 * （CLAUDE.md）の実体そのもので、片方だけ直せてしまう状態を作らない。
 *
 * 値は必ず textContent で入れる。innerHTML に入るのは icon() が返す定数と
 * CHECK_MARK だけ（CLAUDE.md の規約）。
 */

import { el } from "./dom.js";
import { icon } from "./icons.js";

/** 文字は textContent、アイコンだけ定数の innerHTML。値は絶対に混ぜない。 */
export function iconButton(cls, iconId, label) {
  const button = el("button", cls);
  button.type = "button";
  button.innerHTML = icon(iconId, "ico--sm");
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

/**
 * 1 度目で身構え、2 度目で実行するボタン。`confirm()` は使わない（CLAUDE.md）。
 * 見た目だけでなく aria-label と title も変える ── 読み上げだけを使う人にも
 * 「次で消える」ことが伝わらないと、身構える意味が無い。
 */
export function armedIconButton({ cls, armedCls, iconId, label, armedLabel, onConfirm }) {
  const button = iconButton(cls, iconId, label);
  let armed = false;
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.className = armedCls;
      button.setAttribute("aria-label", armedLabel);
      button.title = armedLabel;
      return;
    }
    onConfirm();
  });
  return button;
}

/**
 * チェックの印。**icon("i-check") を使わないこと。**
 *
 * controls.css の `.check__box svg path` が stroke-dashoffset を遷移させて
 * チェックを描くアニメーションを持っている。icon() が返すのは
 * `<svg><use href="#i-check"/></svg>` で、path はシャドウツリーの中に入るため
 * このセレクタが届かない ── チェックを入れても印が出ないボックスになる。
 *
 * event-form.js:126 と aman-mock.html:2487 にも同じ生の SVG がある。
 * そちらは今回のフェーズの範囲外だが、**新しく 4 か所目を作らないために**
 * ここへ集約した（設計書 §13 の「小さいもの」）。
 */
export const CHECK_MARK =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="m4.5 12.6 5.2 5.2L19.5 6.6"/></svg>';
```

- [ ] **Step 6e: `packing-render.js` を import に切り替える**

`iconButton` / `armedIconButton` / `CHECK_MARK` の**定義を削除**し、import に置き換える:

```javascript
import { iconButton, armedIconButton, CHECK_MARK } from "./row-controls.js";
```

`el` と `icon` の import は他でも使っているので残す（`grep -n "icon(" assets/js/packing-render.js` で確認）。

- [ ] **Step 6f: 通ることを確かめる**

Run: `node --test tests/row-controls.test.js tests/packing-render.test.js`
Expected: PASS（row-controls 6 件、packing-render は既存の件数のまま）

- [ ] **Step 7: 生の書式が残っていないことを確かめる**

Run:
```bash
grep -rn '"item:\|`item:\|"group:\|`group:' assets/js/packing-render.js assets/js/packing.js
grep -n "function iconButton\|function armedIconButton\|const CHECK_MARK" assets/js/packing-render.js
```
Expected: どちらも出力なし（書式は `focus-key.js`、ボタン部品は `row-controls.js` だけが持っている状態）

- [ ] **Step 8: 全テストを流す**

Run: `node --test`
Expected: PASS。**508 + 10 = 518**（focus-key 4 件、row-controls 6 件）

- [ ] **Step 9: ブラウザでフォーカスの退行が無いことを確かめる**

持ち物ページで「リストを編集」→ 項目の ↑ ボタンを Tab で選び Enter → **押したあとも同じ（または隣接する）ボタンにフォーカスが残る**こと。落ちるようなら書式がずれている。

- [ ] **Step 10: コミット**

```bash
git add assets/js/focus-key.js assets/js/row-controls.js assets/js/packing-render.js assets/js/packing.js tests/focus-key.test.js tests/row-controls.test.js
git commit -m "Move the shared row pieces somewhere a second page can reach them"
```

---

## Task 3: お土産データの純粋操作

**Files:**
- Create: `assets/js/souvenirs-data.js`
- Create: `tests/fixtures/souvenirs.js`
- Create: `tests/souvenirs-data.test.js`

**Interfaces:**
- Produces:
  - `emptySouvenirs() => { items: [] }`
  - `nextSouvenirId(items: object[]) => string` — `sv-001` 形式
  - `withSouvenir(data, item) => data` — 同じ id があれば差し替え、無ければ末尾に足す
  - `withoutSouvenir(data, id) => data`
  - `progressOf(data) => { done: number, total: number }`
  - `shopSuggestions(data) => string[]` — 入力済みの店名を重複なく、五十音ではなく**出現順**で

- [ ] **Step 1: `tests/fixtures/souvenirs.js` を書く**

```javascript
/**
 * お土産リストのテスト用データ。
 *
 * 実データ（assets/data/souvenirs.json）は暗号文なので読めない。
 * ここが持っている性質を減らすと、対応するテストが「通るが何も検査していない」
 * 状態になる。
 *
 * 意図的に含めてある性質:
 * - bought が true の行と false の行（進捗が両方を数えること）
 * - note が空の行と、note を持つ行
 * - recipient が空の行（「何を」だけ決まっていて相手が未定。空文字を許す設計）
 * - shop が重複する 2 行（候補が重複を落とすこと）
 * - shop が空の行（候補が空文字を拾わないこと）
 */
export const SOUVENIRS = {
  updatedAt: "2026-08-10T00:00:00.000Z",
  items: [
    {
      id: "sv-001",
      name: "ドライマンゴー",
      recipient: "会社",
      shop: "空港",
      note: "5袋くらい",
      bought: true,
    },
    {
      id: "sv-002",
      name: "タイパンツ",
      recipient: "弟",
      shop: "チャトチャック市場",
      note: "",
      bought: false,
    },
    {
      id: "sv-003",
      name: "石けん",
      recipient: "母",
      shop: "チャトチャック市場",
      note: "香りの強すぎないもの",
      bought: false,
    },
    { id: "sv-004", name: "トムヤムクンの素", recipient: "", shop: "", note: "", bought: false },
  ],
};
```

- [ ] **Step 2: `tests/souvenirs-data.test.js` を書く**

```javascript
/**
 * souvenirs-data.js の純粋関数。
 *
 * packing-data.test.js と同じ方針で、「壊れたときの失われ方が静かな」操作を
 * 1 つずつ確かめる ── 「追加したら別の行が消えていた」は、次にそのリストを
 * 見るまで誰も気付かない。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySouvenirs,
  nextSouvenirId,
  withSouvenir,
  withoutSouvenir,
  progressOf,
  shopSuggestions,
} from "../assets/js/souvenirs-data.js";
import { SOUVENIRS } from "./fixtures/souvenirs.js";

/* packing-data.test.js と同じ形。structuredClone ではなく JSON 往復を使うのは、
   既存のテストがそう書いてあるため（読む人が 2 つの流儀を覚えなくて済む）。 */
const clone = () => JSON.parse(JSON.stringify(SOUVENIRS));

test("emptySouvenirs: 空の items を持つ", () => {
  assert.deepEqual(emptySouvenirs(), { items: [] });
});

test("nextSouvenirId: 空なら sv-001", () => {
  assert.equal(nextSouvenirId([]), "sv-001");
});

test("nextSouvenirId: 既存と衝突しない", () => {
  const id = nextSouvenirId(SOUVENIRS.items);
  assert.ok(!SOUVENIRS.items.some((i) => i.id === id), `${id} が既存と衝突しています`);
});

test("nextSouvenirId: 途中を消したデータでも衝突しない", () => {
  // 件数から作った候補が埋まっている状況。件数と最大値がずれるので、
  // 「使われていないこと」を確かめずに採番すると重複する
  const items = [{ id: "sv-001" }, { id: "sv-002" }, { id: "sv-005" }];
  const id = nextSouvenirId(items);
  assert.ok(!items.some((i) => i.id === id), `${id} が既存と衝突しています`);
});

test("withSouvenir: 新しい id なら末尾に足す", () => {
  const data = clone();
  const next = withSouvenir(data, {
    id: "sv-999",
    name: "新しいお土産",
    recipient: "",
    shop: "",
    note: "",
    bought: false,
  });
  assert.equal(next.items.length, SOUVENIRS.items.length + 1);
  assert.equal(next.items.at(-1).id, "sv-999");
});

test("withSouvenir: 既存の id なら位置を変えずに差し替える", () => {
  const data = clone();
  const next = withSouvenir(data, { ...data.items[1], bought: true });
  assert.equal(next.items.length, SOUVENIRS.items.length, "件数が変わっています");
  assert.equal(next.items[1].id, "sv-002", "位置が動いています");
  assert.equal(next.items[1].bought, true);
});

test("withSouvenir: 元のデータを書き換えない", () => {
  const data = clone();
  withSouvenir(data, { ...data.items[0], name: "書き換え" });
  assert.deepEqual(data, SOUVENIRS, "渡したデータが変更されました");
});

test("withoutSouvenir: 指定した行だけ消す", () => {
  const next = withoutSouvenir(clone(), "sv-002");
  assert.equal(next.items.length, SOUVENIRS.items.length - 1);
  assert.ok(!next.items.some((i) => i.id === "sv-002"));
  assert.ok(next.items.some((i) => i.id === "sv-003"), "隣の行まで消えています");
});

test("withoutSouvenir: 無い id を渡しても何も消さない", () => {
  const next = withoutSouvenir(clone(), "sv-nope");
  assert.equal(next.items.length, SOUVENIRS.items.length);
});

test("progressOf: bought の数と全体を返す", () => {
  assert.deepEqual(progressOf(SOUVENIRS), { done: 1, total: 4 });
});

test("progressOf: 空でもゼロ除算にならない値を返す", () => {
  // 割り算は呼び出し側（描画）に任せるので、ここは 0/0 を素直に返す
  assert.deepEqual(progressOf(emptySouvenirs()), { done: 0, total: 0 });
});

test("progressOf: bought が true 以外は買っていない扱い", () => {
  // "true" のような文字列を真として数えない（validate が弾くが、二重の守り）
  const data = { items: [{ id: "a", bought: "true" }, { id: "b", bought: 1 }] };
  assert.deepEqual(progressOf(data), { done: 0, total: 2 });
});

test("shopSuggestions: 重複を落として出現順に返す", () => {
  assert.deepEqual(shopSuggestions(SOUVENIRS), ["空港", "チャトチャック市場"]);
});

test("shopSuggestions: 空文字は候補にしない", () => {
  // sv-004 の shop は "" 。候補に空行が出ると選べてしまう
  assert.ok(!shopSuggestions(SOUVENIRS).includes(""));
});

test("shopSuggestions: 空のリストでは空配列", () => {
  assert.deepEqual(shopSuggestions(emptySouvenirs()), []);
});
```

- [ ] **Step 3: 落ちることを確かめる**

Run: `node --test tests/souvenirs-data.test.js`
Expected: FAIL（`Cannot find module '../assets/js/souvenirs-data.js'`）

- [ ] **Step 4: `assets/js/souvenirs-data.js` を書く**

```javascript
/**
 * お土産リストの純粋なデータ操作。DOM も store も知らない。
 *
 * packing-data.js と同じ考え方で、「壊れたときの失われ方が静かな部分」を
 * ここへ集めてある ── 「追加したら別の行が消えていた」は、次にそのリストを
 * 見るまで誰も気付かない。
 *
 * すべての関数は新しいオブジェクトを返し、渡されたデータを変更しない。
 * 描画の途中で配列を書き換えると、保存されるものと画面に出ているものが食い違う。
 *
 * **持ち物（packing-data.js）と違い、階層も members も持たない。** 理由は
 * 設計書 §4.5 ── 区分を挟むと相手軸と店軸のどちらか一方でしか読めなくなり、
 * 贈り先は行ごとの自由記述なので事前に列挙できない。
 */

/** 何も無い状態のお土産リスト。 */
export function emptySouvenirs() {
  return { items: [] };
}

/**
 * 既存と衝突しない id を採番する。
 *
 * 件数から作った候補が埋まっていれば次を試す。途中を削除したデータでは
 * 件数と最大値がずれるので、「使われていないこと」を必ず確かめる
 * （packing-data.js の nextId と同じ理由 ── id が重複すると、
 * チェックの切り替えが別の行に飛ぶ）。
 */
export function nextSouvenirId(items) {
  const used = new Set(items.map((i) => i?.id));
  for (let n = used.size + 1; ; n++) {
    const id = `sv-${String(n).padStart(3, "0")}`;
    if (!used.has(id)) return id;
  }
}

/**
 * 1 行を差し替えた（同じ id が無ければ末尾に足した）新しいデータを返す。
 * 差し替えは位置を変えない ── 編集するたびに行が動いたら読めなくなる。
 */
export function withSouvenir(data, item) {
  const index = data.items.findIndex((i) => i?.id === item.id);
  const items =
    index === -1
      ? [...data.items, item]
      : data.items.map((i, n) => (n === index ? item : i));
  return { ...data, items };
}

/** 1 行を取り除いた新しいデータを返す。 */
export function withoutSouvenir(data, id) {
  return { ...data, items: data.items.filter((i) => i?.id !== id) };
}

/**
 * 買った数と全体。
 *
 * total を分母に使う側（進捗バー）がゼロ除算にならないよう、件数をそのまま返して
 * 割り算は呼び出し側に任せる。1 行も無い状態は実際に起こる。
 *
 * `=== true` で見る ── `"false"` のような文字列を真として数えない
 * （検査で弾くが、進捗が黙って狂う種類の壊れ方なので二重に守る）。
 */
export function progressOf(data) {
  let done = 0;
  for (const item of data.items) {
    if (item?.bought === true) done++;
  }
  return { done, total: data.items.length };
}

/**
 * 入力済みの店名を、重複なく出現順で返す。
 *
 * 「どこで」は自由入力にした（設計書 §7.6）。旅程の買物スポットから選ばせると
 * 2 つの JSON が相互に依存し、旅程からその予定を消した瞬間にお土産側の参照が
 * 迷子になる。表記の揺れは、この候補を datalist に出すことで実用上は防ぐ。
 *
 * 五十音順に並べ替えない ── 直前に入力した店が先頭付近に残るほうが、
 * 同じ店の行を続けて足すときに速い。
 */
export function shopSuggestions(data) {
  const seen = [];
  for (const item of data.items) {
    const shop = item?.shop;
    if (typeof shop === "string" && shop !== "" && !seen.includes(shop)) {
      seen.push(shop);
    }
  }
  return seen;
}
```

- [ ] **Step 5: 通ることを確かめる**

Run: `node --test tests/souvenirs-data.test.js`
Expected: PASS（15 件）

- [ ] **Step 6: コミット**

```bash
git add assets/js/souvenirs-data.js tests/souvenirs-data.test.js tests/fixtures/souvenirs.js
git commit -m "Add the souvenir list operations, flat where packing is nested"
```

---

## Task 4: お土産データの検査

**Files:**
- Create: `assets/js/souvenirs-validate.js`
- Create: `tests/souvenirs-validate.test.js`

**Interfaces:**
- Consumes: `DataError`（`assets/js/data-error.js`）
- Produces:
  - `class SouvenirDataError extends DataError`
  - `validateSouvenir(item, seenIds?: Set, where?: string) => string[]`（不備の一覧。空なら妥当）
  - `validateSouvenirs(data) => data`（通れば data をそのまま返し、通らなければ投げる）

- [ ] **Step 1: `tests/souvenirs-validate.test.js` を書く**

```javascript
/**
 * validateSouvenirs()。packing-validate.test.js と同じ方針で、
 * 「破ると静かに壊れる」前提だけを見ていることを確かめる。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSouvenirs,
  validateSouvenir,
  SouvenirDataError,
} from "../assets/js/souvenirs-validate.js";
import { DataError } from "../assets/js/data-error.js";
import { SOUVENIRS } from "./fixtures/souvenirs.js";

const clone = () => JSON.parse(JSON.stringify(SOUVENIRS));

test("SouvenirDataError は DataError を継承する", () => {
  // load-error.js の toLoadError() が DataError で分岐しているので、
  // 継承が切れると読み込み失敗が「取得できませんでした」に化ける
  assert.ok(new SouvenirDataError("x") instanceof DataError);
});

test("正しいデータはそのまま返る", () => {
  const data = clone();
  assert.equal(validateSouvenirs(data), data);
});

test("空のリストは妥当", () => {
  const data = { items: [] };
  assert.equal(validateSouvenirs(data), data);
});

test("トップレベルがオブジェクトでなければ投げる", () => {
  assert.throws(() => validateSouvenirs([]), SouvenirDataError);
  assert.throws(() => validateSouvenirs(null), SouvenirDataError);
});

test("items が配列でなければ名指しで投げる", () => {
  assert.throws(() => validateSouvenirs({ items: {} }), /items が配列ではありません/);
});

test("id が空なら弾く", () => {
  const data = clone();
  data.items[0].id = "";
  assert.throws(() => validateSouvenirs(data), /id が空でない文字列ではありません/);
});

test("id の重複を弾く", () => {
  const data = clone();
  data.items[1].id = data.items[0].id;
  assert.throws(() => validateSouvenirs(data), /id が重複しています/);
});

test("bought が真偽値でなければ弾く", () => {
  // "false" は真として扱われ、進捗が黙って狂う
  const data = clone();
  data.items[0].bought = "false";
  assert.throws(() => validateSouvenirs(data), /買ったかどうかが真偽値ではありません/);
});

test("bought が無い行を弾く", () => {
  const data = clone();
  delete data.items[0].bought;
  assert.throws(() => validateSouvenirs(data), /買ったかどうかが真偽値ではありません/);
});

test("name / recipient / shop は空文字を許す", () => {
  // 「何を」だけ決まっていて相手も店も未定、という行が普通に生まれる（設計書 §4.5）
  const data = { items: [{ id: "sv-001", name: "", recipient: "", shop: "", bought: false }] };
  assert.doesNotThrow(() => validateSouvenirs(data));
});

test("name が文字列でなければ弾く", () => {
  const data = clone();
  data.items[0].name = 123;
  assert.throws(() => validateSouvenirs(data), /name が文字列ではありません/);
});

test("recipient が文字列でなければ弾く", () => {
  const data = clone();
  data.items[0].recipient = null;
  assert.throws(() => validateSouvenirs(data), /recipient が文字列ではありません/);
});

test("shop が文字列でなければ弾く", () => {
  const data = clone();
  data.items[0].shop = {};
  assert.throws(() => validateSouvenirs(data), /shop が文字列ではありません/);
});

test("note は省略できる", () => {
  const data = clone();
  delete data.items[0].note;
  assert.doesNotThrow(() => validateSouvenirs(data));
});

test("note が文字列でなければ弾く", () => {
  const data = clone();
  data.items[0].note = 5;
  assert.throws(() => validateSouvenirs(data), /note が文字列ではありません/);
});

test("不備は 1 件目で止めずにまとめて報告する", () => {
  const data = { items: [{ id: "", name: 1, bought: "no" }] };
  try {
    validateSouvenirs(data);
    assert.fail("投げませんでした");
  } catch (error) {
    assert.match(error.message, /3 件の不備/);
  }
});

test("不備が多いときは先頭だけ出して残りは件数で示す", () => {
  const items = Array.from({ length: 20 }, (_, n) => ({ id: `x-${n}`, name: 1, bought: false }));
  try {
    validateSouvenirs({ items });
    assert.fail("投げませんでした");
  } catch (error) {
    assert.match(error.message, /…ほか 10 件/);
  }
});

test("id を持たない行は配列上の位置で名指しする", () => {
  try {
    validateSouvenirs({ items: [{ name: "x", bought: false }] });
    assert.fail("投げませんでした");
  } catch (error) {
    assert.match(error.message, /items\[0\]/);
  }
});

test("validateSouvenir: 1 件だけを検査して不備の配列を返す", () => {
  const problems = validateSouvenir({ id: "a", name: "x", bought: false });
  assert.deepEqual(problems, []);
});

test("validateSouvenir: 渡した Set に id を足していく", () => {
  const seen = new Set();
  validateSouvenir({ id: "a", name: "x", bought: false }, seen);
  const problems = validateSouvenir({ id: "a", name: "y", bought: false }, seen);
  assert.match(problems.join("\n"), /id が重複しています/);
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node --test tests/souvenirs-validate.test.js`
Expected: FAIL（`Cannot find module`）

- [ ] **Step 3: `assets/js/souvenirs-validate.js` を書く**

```javascript
/**
 * souvenirs.json の形を、描画が始まる前に一度だけ検査する。
 *
 * validate.js（旅程）/ packing-validate.js（持ち物）と同じ方針:
 * 破ると静かに壊れる前提だけを見て、不備は 1 件目で止めずに全部集め、
 * どの行の何が悪いのかを名指しする。
 *
 * ここで見る「静かに壊れる」の中身:
 *
 * - id が重複すると、チェックの切り替えが別の行に飛ぶ（行の特定に data-id を使う）
 * - bought が真偽値でないと進捗が黙って狂う（"false" は真になる）
 *
 * name / recipient / shop に**空文字を許す**のは意図的（設計書 §4.5）──
 * 「何を」だけ決まっていて相手も店も未定、という行が普通に生まれる。
 * ここを必須にすると、思いついたものを書き留められない。
 *
 * 設計書 §4.5 に対応。
 */

import { DataError } from "./data-error.js";

/** お土産データ内容の不備。通信・パース失敗とは呼び出し側で区別する。 */
export class SouvenirDataError extends DataError {
  constructor(message) {
    super(message);
    this.name = "SouvenirDataError";
  }
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v !== "";
const show = (v) => (typeof v === "number" ? String(v) : JSON.stringify(v));

/** エラー文で行を名指しするためのラベル。packing-validate.js の labelOf と同じ形。 */
function labelOf(item, where) {
  const id = isNonEmptyString(item?.id) ? item.id : where;
  const name = isNonEmptyString(item?.name) ? `「${item.name}」` : "";
  return `${id}${name}`;
}

/**
 * 1 行を検査して、不備の一覧を返す（空配列なら妥当）。
 *
 * **1 行に対する規則の置き場所はここ 1 か所だけ**にする ── 画面側が書き写すと、
 * 写しがずれた瞬間に「保存はできるが次の読み込みで弾かれる」データを作れてしまう
 * （validate.js の validateEvent / formProblems と同じ関係）。
 *
 * @param {object} item 検査する行
 * @param {Set<string>} seenIds すでに使われている id。通ったものを足していく
 * @param {string} where id を持たない行の呼び方
 * @returns {string[]} 不備の一覧
 */
export function validateSouvenir(item, seenIds = new Set(), where = "お土産") {
  const problems = [];

  if (!isPlainObject(item)) {
    problems.push(`${where} がオブジェクトではありません`);
    return problems;
  }

  const label = labelOf(item, where);

  if (!isNonEmptyString(item.id)) {
    problems.push(`${where}: id が空でない文字列ではありません`);
  } else if (seenIds.has(item.id)) {
    problems.push(`${label}: id が重複しています`);
  } else {
    seenIds.add(item.id);
  }

  // 空文字は許す。型だけを見る（設計書 §4.5）
  for (const [field, jp] of [
    ["name", "name"],
    ["recipient", "recipient"],
    ["shop", "shop"],
  ]) {
    if (typeof item[field] !== "string") {
      problems.push(`${label}: ${jp} が文字列ではありません（${show(item[field])}）`);
    }
  }

  // note は省略できる
  if (item.note !== undefined && typeof item.note !== "string") {
    problems.push(`${label}: note が文字列ではありません（${show(item.note)}）`);
  }

  if (typeof item.bought !== "boolean") {
    // "false" のような文字列は真として扱われ、進捗が黙って狂う
    problems.push(`${label}: 買ったかどうかが真偽値ではありません（${show(item.bought)}）`);
  }

  return problems;
}

/**
 * 検査に通れば data をそのまま返す。通らなければ SouvenirDataError を投げる。
 * 戻り値を使うことで、呼び出し側が「検査してから代入する」形に自然に書ける。
 */
export function validateSouvenirs(data) {
  const problems = [];

  if (!isPlainObject(data)) {
    throw new SouvenirDataError("souvenirs.json のトップレベルがオブジェクトではありません");
  }

  if (!Array.isArray(data.items)) {
    problems.push("items が配列ではありません");
  } else {
    const seenIds = new Set();
    data.items.forEach((item, i) =>
      problems.push(...validateSouvenir(item, seenIds, `items[${i}]`))
    );
  }

  if (problems.length) {
    // 全部並べると数百行になりうるので先頭だけ出し、残りは件数で示す
    const shown = problems.slice(0, 10);
    const rest = problems.length - shown.length;
    const tail = rest > 0 ? `\n…ほか ${rest} 件` : "";
    throw new SouvenirDataError(
      `お土産データに ${problems.length} 件の不備があります:\n- ${shown.join("\n- ")}${tail}`
    );
  }

  return data;
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test tests/souvenirs-validate.test.js`
Expected: PASS（20 件）

- [ ] **Step 5: 全テストを流す**

Run: `node --test`
Expected: PASS。**518 + 15 + 20 = 553**（実績は 554 ── レビューの裁定で検査を固定するテストを 1 件足したため）

- [ ] **Step 6: コミット**

```bash
git add assets/js/souvenirs-validate.js tests/souvenirs-validate.test.js
git commit -m "Check the souvenir list before anything tries to draw it"
```

---

## Task 5: お土産リストの描画

**Files:**
- Create: `assets/js/souvenirs-render.js`
- Create: `tests/souvenirs-render.test.js`

**Interfaces:**
- Consumes: `progressOf` / `shopSuggestions`（Task 3）、`souvenirFocusKey` / `armedIconButton` / `CHECK_MARK`（Task 2）、`el`（`dom.js`）
- Produces:
  - `renderProgress({ mount, data }) => void`
  - `renderTable({ mount, data, editing, handlers }) => void`
  - `handlers` の口: `onToggle(id, bought)` / `onEdit(id, patch)` / `onDelete(id)`

**設計上の要点**

- **「買った」チェックは editing に関わらず出す**（設計書 §4.5）。旅行中いちばん使う操作なので、編集モードの内側に置くと店先で毎回 2 手増える
- 値は必ず `el()`（`textContent`）で入れる。`innerHTML` に入るのは `icon()` が返す定数と `CHECK_MARK` だけ
- ボタン部品とチェックの印は `row-controls.js`（Task 2）から import する。**このファイルで定義し直さないこと**
- 並べ替えは無いので ↑↓ もドラッグハンドルも作らない

- [ ] **Step 1: `tests/souvenirs-render.test.js` を書く**

```javascript
/**
 * souvenirs-render.js の描画テスト。
 *
 * packing-render.test.js と同じ最小 DOM スタブを使う。狙いは
 * 「イベント由来の文字列が innerHTML に流れていないこと」の検査
 * （このページはリポジトリ書き込み権限を持つトークンを抱えている）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderProgress, renderTable } from "../assets/js/souvenirs-render.js";
import { SOUVENIRS } from "./fixtures/souvenirs.js";

/** packing-render.test.js と同じ最小スタブ。innerHTML と textContent を別に記録する。 */
function stubDocument() {
  const htmlSink = [];
  const textSink = [];
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      style: {},
      attrs: {},
      listeners: {},
      value: "",
      set innerHTML(v) {
        htmlSink.push(String(v));
        this._html = String(v);
      },
      get innerHTML() {
        return this._html ?? "";
      },
      set textContent(v) {
        textSink.push(String(v));
        this._text = String(v);
      },
      get textContent() {
        return this._text ?? "";
      },
      setAttribute(k, v) {
        this.attrs[k] = String(v);
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      replaceChildren(...kids) {
        this.children = kids;
      },
      addEventListener(type, fn) {
        (this.listeners[type] ??= []).push(fn);
      },
      dispatch(type) {
        for (const fn of this.listeners[type] ?? []) fn();
      },
    };
    return node;
  };
  globalThis.document = { createElement: make };
  return { htmlSink, textSink, make };
}

const mountNode = (make) => make("div");

/** 深さ優先で全ノードを列挙する。 */
function walk(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

const findByFocusKey = (root, key) =>
  walk(root).find((n) => n.dataset?.focusKey === key);

test("renderProgress: 買った数と全体を出す", () => {
  const { make, textSink } = stubDocument();
  const mount = mountNode(make);
  renderProgress({ mount, data: SOUVENIRS });
  assert.ok(textSink.includes("1 / 4"), `進捗が出ていません: ${textSink.join(" | ")}`);
});

test("renderProgress: 空でも落ちず 0 / 0 を出す", () => {
  const { make, textSink } = stubDocument();
  const mount = mountNode(make);
  renderProgress({ mount, data: { items: [] } });
  assert.ok(textSink.includes("0 / 0"));
});

test("renderTable: 空のときは案内を出す（編集中かどうかで文言が違う）", () => {
  const { make, textSink } = stubDocument();
  const mount = mountNode(make);
  renderTable({ mount, data: { items: [] }, editing: false });
  assert.ok(textSink.some((t) => t.includes("リストを編集")), textSink.join(" | "));

  const second = stubDocument();
  const mount2 = mountNode(second.make);
  renderTable({ mount: mount2, data: { items: [] }, editing: true });
  assert.ok(second.textSink.some((t) => t.includes("お土産を追加")), second.textSink.join(" | "));
});

test("renderTable: 何を・誰に・どこで・メモを textContent で出す", () => {
  const { make, textSink } = stubDocument();
  const mount = mountNode(make);
  renderTable({ mount, data: SOUVENIRS, editing: false });
  for (const expected of ["ドライマンゴー", "会社", "空港", "5袋くらい"]) {
    assert.ok(textSink.includes(expected), `${expected} が出ていません`);
  }
});

test("renderTable: 値が innerHTML に流れない", () => {
  const payload = '<img src=x onerror="window.__pwned=1">';
  const { make, htmlSink } = stubDocument();
  const mount = mountNode(make);
  renderTable({
    mount,
    data: { items: [{ id: "sv-1", name: payload, recipient: payload, shop: payload, note: payload, bought: false }] },
    editing: false,
  });
  for (const html of htmlSink) {
    assert.ok(!html.includes(payload), `innerHTML に値が流れました: ${html}`);
  }
});

test("renderTable: 各行に data-item-id を付ける", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  renderTable({ mount, data: SOUVENIRS, editing: false });
  const ids = walk(mount)
    .map((n) => n.dataset?.itemId)
    .filter(Boolean);
  assert.deepEqual(ids, ["sv-001", "sv-002", "sv-003", "sv-004"]);
});

test("renderTable: 「買った」は編集モードでなくても押せる", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  const seen = [];
  renderTable({
    mount,
    data: SOUVENIRS,
    editing: false,
    handlers: { onToggle: (id, bought) => seen.push([id, bought]) },
  });
  const check = findByFocusKey(mount, "sv:sv-002:bought");
  assert.ok(check, "チェックが読み取りモードで出ていません");
  check.checked = true;
  check.dispatch("change");
  assert.deepEqual(seen, [["sv-002", true]]);
});

test("renderTable: 編集モードでだけ入力欄と削除が出る", () => {
  const { make } = stubDocument();
  const read = mountNode(make);
  renderTable({ mount: read, data: SOUVENIRS, editing: false });
  assert.equal(findByFocusKey(read, "sv:sv-001:name"), undefined, "読み取りモードに入力欄があります");
  assert.equal(findByFocusKey(read, "sv:sv-001:del"), undefined, "読み取りモードに削除があります");

  const edit = mountNode(make);
  renderTable({ mount: edit, data: SOUVENIRS, editing: true });
  for (const field of ["name", "recipient", "shop", "note", "del"]) {
    assert.ok(findByFocusKey(edit, `sv:sv-001:${field}`), `${field} が編集モードに出ていません`);
  }
});

test("renderTable: 入力欄の change が onEdit にキーと値を渡す", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  const seen = [];
  renderTable({
    mount,
    data: SOUVENIRS,
    editing: true,
    handlers: { onEdit: (id, patch) => seen.push([id, patch]) },
  });
  const shop = findByFocusKey(mount, "sv:sv-002:shop");
  shop.value = "MBK センター";
  shop.dispatch("change");
  assert.deepEqual(seen, [["sv-002", { shop: "MBK センター" }]]);
});

test("renderTable: 削除は 1 度目で身構え、2 度目で実行する", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  const deleted = [];
  renderTable({
    mount,
    data: SOUVENIRS,
    editing: true,
    handlers: { onDelete: (id) => deleted.push(id) },
  });
  const del = findByFocusKey(mount, "sv:sv-001:del");
  del.dispatch("click");
  assert.deepEqual(deleted, [], "1 度目で消えました");
  del.dispatch("click");
  assert.deepEqual(deleted, ["sv-001"]);
});

test("renderTable: 店名の候補を datalist に出す（重複なし・空文字なし）", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  renderTable({ mount, data: SOUVENIRS, editing: true });
  const options = walk(mount)
    .filter((n) => n.tagName === "OPTION")
    .map((n) => n.attrs.value);
  assert.deepEqual(options, ["空港", "チャトチャック市場"]);
});

test("renderTable: handlers を渡さなくても落ちない", () => {
  // テストや初回描画が空で呼ぶ
  const { make } = stubDocument();
  const mount = mountNode(make);
  assert.doesNotThrow(() => renderTable({ mount, data: SOUVENIRS, editing: true }));
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node --test tests/souvenirs-render.test.js`
Expected: FAIL（`Cannot find module`）

- [ ] **Step 3: `assets/js/souvenirs-render.js` を書く**

```javascript
/**
 * お土産リストの描画。
 *
 * 通常時は読むだけの静かな見た目、「リストを編集」で編集モードへ（設計書 §7.6）。
 * **ただし「買った」のチェックだけは通常時にも押せる** ── 旅行中いちばん使う
 * 操作で、そこを編集モードの内側に置くと店先で毎回 2 手増える（設計書 §4.5）。
 *
 * 2 つのモードを別の関数にせず editing で分けるのは、行の構造を 1 か所に保つため。
 *
 * 値は必ず el()（textContent）で入れる。innerHTML に入るのは icon() が返す定数と
 * CHECK_MARK だけ。ブラウザで入力した文字列を、リポジトリ書き込み権限を持つ
 * トークンを抱えたページ自身が描画するため（CLAUDE.md の規約）。
 *
 * 操作コントロールには dataset.focusKey を付ける。souvenirs.js の draw() が
 * 再描画のたびに document.activeElement のこのキーを控え、描き直したあと同じ
 * キーを持つ要素へフォーカスを戻す（packing-render.js と同じ考え方）。
 * 書式は focus-key.js が持つ ── 両側が同じ関数を呼ばないと、片方だけ変えても
 * 例外が出ずフォーカスが静かに落ちる（設計書 §13）。
 */

import { el } from "./dom.js";
import { souvenirFocusKey } from "./focus-key.js";
import { armedIconButton, CHECK_MARK } from "./row-controls.js";
import { progressOf, shopSuggestions } from "./souvenirs-data.js";

/** 店名の候補をぶら下げる datalist の id。input の list 属性から引く。 */
const SHOP_LIST_ID = "sv-shops";

/**
 * 買った数と細いバー（設計書 §7.6）。
 * 割り算はここで行い、total が 0 のときは 0% にする ── 1 行も無い状態は実際に起こる。
 */
export function renderProgress({ mount, data }) {
  const { done, total } = progressOf(data);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const one = el("div", "svprog__one");
  one.appendChild(el("p", "svprog__name", "買った"));
  one.appendChild(el("p", "svprog__count", `${done} / ${total}`));

  const bar = el("div", "svprog__bar");
  const fill = el("div", "svprog__fill");
  fill.style.width = `${percent}%`;
  bar.appendChild(fill);
  one.appendChild(bar);

  one.setAttribute("role", "group");
  one.setAttribute("aria-label", `買った ${done} / ${total}`);
  mount.replaceChildren(one);
}

/**
 * 「買った」のチェック 1 つ。**編集モードでなくても押せる。**
 *
 * マークアップは controls.css の `.check` の契約に合わせる:
 *   label.switch > span.check > (input[type=checkbox] + span.check__box > svg)
 * input と .check__box が**隣接兄弟**であること。間に何か挟むと、
 * チェックしても色が変わらない。
 */
function boughtCell(item, onToggle) {
  const label = el("label", "switch");

  const wrap = el("span", "check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = item.bought === true;
  input.setAttribute("aria-label", `買った: ${item.name}`);
  input.dataset.focusKey = souvenirFocusKey(item.id, "bought");
  input.addEventListener("change", () => onToggle?.(item.id, input.checked));

  const box = el("span", "check__box");
  box.innerHTML = CHECK_MARK; // 定数のみ。値は混ぜない

  wrap.appendChild(input);
  wrap.appendChild(box);
  label.appendChild(wrap);
  return label;
}

/** 編集モードの入力欄 1 つ。change で patch を送る。 */
function field(item, name, { cls, placeholder, ariaLabel, list }, onEdit) {
  const input = document.createElement("input");
  input.className = cls;
  input.type = "text";
  input.value = item[name] ?? "";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", ariaLabel);
  if (list) input.setAttribute("list", list);
  input.dataset.focusKey = souvenirFocusKey(item.id, name);
  input.addEventListener("change", () => onEdit?.(item.id, { [name]: input.value }));
  return input;
}

function itemRow(item, editing, handlers) {
  const row = el("li", "svitem");
  row.dataset.itemId = item.id;

  row.appendChild(boughtCell(item, handlers.onToggle));

  const body = el("div", "svitem__body");
  if (!editing) {
    const line = el("p", "svitem__line");
    line.appendChild(el("span", "svitem__name", item.name));
    if (item.recipient) line.appendChild(el("span", "svitem__to", item.recipient));
    if (item.shop) line.appendChild(el("span", "svitem__shop", item.shop));
    body.appendChild(line);
    // メモは 2 行目。読み取りモードで縦を詰めるため、値があるときだけ出す
    if (item.note) body.appendChild(el("p", "svitem__note", item.note));
  } else {
    body.appendChild(
      field(item, "name", { cls: "inp", placeholder: "何を", ariaLabel: "何を" }, handlers.onEdit)
    );
    body.appendChild(
      field(
        item,
        "recipient",
        { cls: "inp inp--note", placeholder: "誰に", ariaLabel: "誰に" },
        handlers.onEdit
      )
    );
    body.appendChild(
      field(
        item,
        "shop",
        { cls: "inp inp--note", placeholder: "どこで", ariaLabel: "どこで", list: SHOP_LIST_ID },
        handlers.onEdit
      )
    );
    body.appendChild(
      field(item, "note", { cls: "inp inp--note", placeholder: "メモ", ariaLabel: "メモ" }, handlers.onEdit)
    );
  }
  row.appendChild(body);

  if (editing) {
    const acts = el("div", "svitem__acts");
    const del = armedIconButton({
      cls: "rowbtn rowbtn--del",
      armedCls: "rowbtn rowbtn--confirm",
      iconId: "i-x",
      label: `${item.name} を削除`,
      armedLabel: "もう一度で削除",
      onConfirm: () => handlers.onDelete?.(item.id),
    });
    del.dataset.focusKey = souvenirFocusKey(item.id, "del");
    acts.appendChild(del);
    row.appendChild(acts);
  }

  return row;
}

/**
 * 入力済みの店名の候補。編集モードのときだけ作る。
 * option の中身は value 属性に入れる（textContent ではなくても datalist は引ける）。
 */
function shopDatalist(data) {
  const list = document.createElement("datalist");
  list.id = SHOP_LIST_ID;
  for (const shop of shopSuggestions(data)) {
    const option = document.createElement("option");
    option.setAttribute("value", shop);
    list.appendChild(option);
  }
  return list;
}

/**
 * 表全体。
 *
 * @param {object} args
 * @param {HTMLElement} args.mount 差し替え先
 * @param {object} args.data お土産データ
 * @param {boolean} args.editing 編集モードか
 * @param {object} args.handlers 行の操作。すべて省略可（テストが空で呼ぶ）
 */
export function renderTable({ mount, data, editing, handlers = {} }) {
  if (data.items.length === 0) {
    const empty = el(
      "p",
      "body",
      editing
        ? "まだ何もありません。「お土産を追加」から始めてください。"
        : "まだ何もありません。「リストを編集」から追加できます。"
    );
    mount.replaceChildren(empty);
    return;
  }

  const list = el("ul", "svitems");
  for (const item of data.items) {
    list.appendChild(itemRow(item, editing, handlers));
  }

  const nodes = [list];
  if (editing) nodes.push(shopDatalist(data));
  mount.replaceChildren(...nodes);
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test tests/souvenirs-render.test.js`
Expected: PASS（12 件）

- [ ] **Step 5: 全テストを流す**

Run: `node --test`
Expected: PASS。**554 + 12 = 566**（Task 4 の修正で 1 件増えたため、当初計画の 553/565 から 1 ずれている）

- [ ] **Step 6: コミット**

```bash
git add assets/js/souvenirs-render.js tests/souvenirs-render.test.js
git commit -m "Draw the souvenir list quietly, and keep the tick reachable without editing"
```

---

## Task 6: ページの器（HTML と CSS）と、それを見張るテスト

**Files:**
- Create: `souvenirs.html`
- Create: `assets/css/souvenirs.css`
- Modify: `tests/csp.test.js`（`PAGES` 定数）
- Modify: `tests/tokens.test.js` の色リテラル検査のファイル一覧

**注意（忘れると検査が黙って素通りする）**

`tests/tokens.test.js` の色リテラル検査は**対象ファイルをハードコードしたリスト**で持っている。`souvenirs.css` を足し忘れても**テストは何も言わずに通る**（`CLAUDE.md`「新しいカテゴリを追加」の末尾に同じ警告がある）。このタスクの Step 4 が唯一の防波堤。

- [ ] **Step 1: `souvenirs.html` を作る**

`packing.html` を写し、CSP は**一字一句そのまま**にする（`tests/csp.test.js` が 4 ページの同一性を見る）。

```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- Phase B でリポジトリ書き込み権限を持つトークンをブラウザに保存するため、
         スクリプトの実行元を自分自身だけに絞る。'unsafe-inline' を入れないので
         インライン script と javascript: URL は実行されない。
         style は Leaflet と自前コードが style 属性を多用するため許可が要る
         （狙いはスクリプト実行の遮断であって、スタイルではない）。 -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self';
               style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
               font-src https://fonts.gstatic.com;
               img-src 'self' data: https:;
               connect-src 'self' https://api.github.com;
               base-uri 'self';
               form-action 'none'"
    />
    <title>Thailand 2026</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,200;6..72,300;6..72,400&family=Inter:wght@300;400;500&family=Noto+Sans+JP:wght@300;400;500&family=Noto+Serif+JP:wght@200;300;400&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="assets/css/tokens.css" />
    <link rel="stylesheet" href="assets/css/base.css" />
    <link rel="stylesheet" href="assets/css/controls.css" />
    <link rel="stylesheet" href="assets/css/souvenirs.css" />
  </head>
  <body data-page="souvenirs">
    <nav class="nav" id="nav"></nav>
    <!-- role / aria-label は他ページと揃える。同じ役割の領域なので -->
    <div class="syncbar" id="syncbar" role="region" aria-label="同期の状態" hidden></div>

    <main class="wrap sec">
      <div class="pagehead reveal">
        <p class="eyebrow">Souvenirs</p>
        <h1 class="display lines"><span class="ln"><i>お土産リスト</i></span></h1>
      </div>

      <div class="svprog reveal" id="sv-progress"></div>

      <div class="toolbar reveal">
        <!-- ラベルとアイコンは JS が入れる。HTML に <use href="#i-..."> を
             直書きすると injectSprite() より前にパースされ、WebKit が参照を
             解決し直さないことがある（packing.html と同じ理由）。
             データが読めていない状態で押されないよう disabled で置く。 -->
        <div class="toolbar__group toolbar__group--end">
          <button class="tbtn" id="sv-edit-toggle" type="button" aria-pressed="false" disabled></button>
          <button class="tbtn" id="sv-add" type="button" disabled></button>
          <!-- 公開ボタンとトークン設定の置き場。トークンが無いときに
               公開ボタンを置かないので、中身は publish-ui.js が入れる。 -->
          <span class="toolbar__group" id="pub-controls"></span>
        </div>
      </div>

      <div class="pub">
        <div class="pubpanel" id="pub-panel" hidden></div>
        <div class="pubstat" id="pub-status" role="status" aria-live="polite" hidden></div>
      </div>

      <div id="sv-table"></div>
    </main>

    <script type="module" src="assets/js/souvenirs.js"></script>
  </body>
</html>
```

- [ ] **Step 2: `assets/css/souvenirs.css` を作る**

**色リテラルを書かないこと**（`tokens.css` の変数と `rgb(var(--ink-rgb) / …)` だけ）。

```css
/* お土産リスト（souvenirs.html）専用。
   色・余白・角丸・モーションの値は tokens.css の変数だけを使う。
   行アクションと入力欄は controls.css の .rowbtn / .inp を流用する
   （.rowbtn--del / .rowbtn--confirm / .inp--note）。
   進捗は packing.css の .pkprog と同じ作法だが、1 本しか出さないので
   クラスを共有せず別に持つ（片方の都合でもう片方が動くのを避ける）。 */

/* ── 進捗 ── */
.svprog {
  margin-top: var(--s3);
}
.svprog__one {
  max-width: 320px;
}
.svprog__name {
  font-size: 11px;
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: var(--ink-2);
}
.svprog__count {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 300;
  color: var(--ink);
}
.svprog__bar {
  height: 2px;
  margin-top: 6px;
  background: var(--line-soft);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.svprog__fill {
  height: 100%;
  background: var(--ink);
  transition: width var(--t-mid) var(--e-out);
}

/* ── 表 ── */
.svitems {
  list-style: none;
  margin: var(--s3) 0 0;
  padding: 0;
  border-top: 1px solid var(--line-soft);
}
.svitem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-top: 1px solid rgb(var(--ink-rgb) / 0.06);
}
.svitem:first-child {
  border-top: 0;
}
.svitem__body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
/* 読み取りモードの 1 行。名前・誰に・どこで を同じ行に流す */
.svitem__line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.svitem__name {
  color: var(--ink);
}
.svitem__to,
.svitem__shop {
  font-size: 12px;
  color: var(--ink-2);
}
/* 「どこで」は薄い囲みにして、誰に と見分けが付くようにする */
.svitem__shop {
  padding: 1px 8px;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-pill);
}
.svitem__note {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--ink-2);
}
.svitem__acts {
  display: flex;
  gap: 2px;
  margin-left: auto;
}

/* 編集モードの入力欄。4 つ並ぶので、狭い画面では折り返させる */
.svitem__body .inp {
  flex: 1 1 140px;
  min-width: 0;
}

/* ── レスポンシブ ── */
/* カレンダーと違い横スクロールにしない。時間軸のような
   「横に連続した意味」を持たないため（設計書 §7.6）。 */
@media (max-width: 760px) {
  .svitem {
    align-items: flex-start;
  }
  .svitem__body .inp {
    flex-basis: 100%;
  }
}
```

- [ ] **Step 3: `tests/csp.test.js` の `PAGES` に足す**

```javascript
// archive.html は取りやめた検索アーカイブの仮ページで、B4 で削除した（設計書 §2.1）
const PAGES = ["index.html", "schedule.html", "packing.html", "souvenirs.html"];
```

- [ ] **Step 4: `tests/tokens.test.js` の色リテラル検査のファイル一覧 の色リテラル検査に足す**

```javascript
  const files = ["base.css", "controls.css", "calendar.css", "packing.css", "souvenirs.css"];
```

**この 1 行を忘れると、`souvenirs.css` に色をハードコードしても検査は素通りする。**

- [ ] **Step 5: 全テストを流す**

Run: `node --test`
Expected: PASS。**CSP の 5 件が 4 ページを見るようになり、色リテラル検査が 1 ファイル増える。件数は 567 のまま**（テストの本数ではなくループの中身が増えるため）

- [ ] **Step 6: 色リテラル検査が実際に効いていることを確かめる**

一時的に `assets/css/souvenirs.css` の `color: var(--ink);` を `color: #313131;` に書き換えて:

Run: `node --test tests/tokens.test.js`
Expected: **FAIL**（`souvenirs.css` に色リテラルがある、と言われる）

確認できたら元に戻し、もう一度流して PASS になることを見る。**これをやらないと Step 4 を忘れたのと同じ状態になる。**

- [ ] **Step 7: コミット**

```bash
git add souvenirs.html assets/css/souvenirs.css tests/csp.test.js tests/tokens.test.js
git commit -m "Give the souvenir page a shell, and put it under the color guard"
```

---

## Task 7: エントリポイント

**Files:**
- Create: `assets/js/souvenirs.js`

**Interfaces:**
- Consumes: Task 1〜5 のすべて、`sync.js` / `publish-ui.js` / `auth.js` / `store.js` / `load-error.js`

**危険な点（`packing.js` の写しで守ること）**

1. **`createSync()` の `config` は 6 つ全部渡す。** 一部だけだと旅程や持ち物の下書きが黙って消える
2. **`souvenirs.json` は最初の公開まで存在しない。** 404 を「まだ無い」として空リストで始める。ここを取り違えると、最初の 1 人が永久にページを開けない
3. **`publish-ui` の組み立ては `load()` より前。** 後ろに置くと、リモートが壊れた端末では公開ボタンもトークン設定も DOM に現れず、ブラウザから直す手段がゼロになる
4. **再描画は予約制（`scheduleDraw`）。** 入力欄の `change` は利用者が押したボタンの `mousedown` の処理中に発火する。そこで `replaceChildren` すると `click` が発火せず、1 度目の「お土産を追加」が効かない（設計書 §13）

- [ ] **Step 1: `assets/js/souvenirs.js` を書く**

```javascript
/**
 * souvenirs.html のエントリポイント。
 *
 * 起動順は packing.js と同じ「鍵の確認 → publish-ui の組み立て → load()」。
 * publish-ui を load() の後ろに置くと、リモートが壊れた端末では公開ボタンも
 * トークン設定も DOM に現れず、ブラウザから直す手段がゼロになる（設計書 §13）。
 *
 * souvenirs.json は**最初の公開までリポジトリに存在しない**。404 を「まだ無い」として
 * 空のリストで始める ── 暗号化した初期ファイルを外から用意する手段が無いため。
 */

import { injectSprite, icon } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { el, escapeHtml } from "./dom.js";
import { createStore } from "./store.js";
import { createSync, DEFAULT_CONFIG } from "./sync.js";
import { createPublishUI } from "./publish-ui.js";
import { classifyLoadError, toLoadError } from "./load-error.js";
import { hasKey, loadCodec, clearKey } from "./auth.js";
import { DataError } from "./data-error.js";
import { createNotices, createDrawLoop } from "./page-notice.js";
import { souvenirFocusKey } from "./focus-key.js";
import { validateSouvenirs } from "./souvenirs-validate.js";
import {
  emptySouvenirs,
  nextSouvenirId,
  withSouvenir,
  withoutSouvenir,
} from "./souvenirs-data.js";
import { renderProgress, renderTable } from "./souvenirs-render.js";

/** どのデータの話かを 1 か所に持つ。sync / publish-ui / load-error の 3 つが読む。 */
const SUBJECT = { noun: "お土産リスト", path: "assets/data/souvenirs.json" };

const state = {
  data: null,
  editing: false,
};

const els = {
  table: document.getElementById("sv-table"),
  progress: document.getElementById("sv-progress"),
  editToggle: document.getElementById("sv-edit-toggle"),
  add: document.getElementById("sv-add"),
  pubControls: document.getElementById("pub-controls"),
  pubPanel: document.getElementById("pub-panel"),
  pubStatus: document.getElementById("pub-status"),
  syncbar: document.getElementById("syncbar"),
};

let publishUI = null;
let sync = null;

/** 通知は 2 つとも page-notice.js が作る（設計書 §13）。 */
const { setNotice, setStampNotice } = createNotices(els.table);

/**
 * 描き直したあとにフォーカスを戻す。
 *
 * renderTable() は毎回 mount.replaceChildren() で全ノードを作り直すので、
 * 押した瞬間のボタンや、入力していた最中の欄はもう文書にいない。
 * キーは id から作ってあるので、行が増減しても同じキーで引ける。
 * 見つからなければ、必ず存在するツールバーの先頭（編集トグル）へ逃がす。
 */
function restoreFocus(focusKey) {
  if (!focusKey) return;
  const next = els.table.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
  (next ?? els.editToggle)?.focus();
}

function draw(focusKeyOverride) {
  const focusKey = focusKeyOverride ?? document.activeElement?.dataset?.focusKey ?? null;

  renderProgress({ mount: els.progress, data: state.data });
  renderTable({
    mount: els.table,
    data: state.data,
    editing: state.editing,
    handlers,
  });

  restoreFocus(focusKey);
}

/**
 * 即時（safeDraw）と予約（scheduleDraw）の 2 つの口。
 *
 * **予約が要る理由と、予約の取り消しが safeDraw の内側にある理由は
 * page-notice.js の createDrawLoop を読むこと**（設計書 §13）── 入力欄の
 * change は利用者が押したボタンの mousedown の処理中に発火するので、
 * そこで表を作り直すと click が発火せず「お土産を追加」が 1 度目で効かない。
 *
 * `const` は巻き上がらない。この行は `els` と `createNotices` の後ろ、
 * かつ最初に safeDraw が呼ばれる前になければ TDZ でページが真っ白になる。
 */
const { safeDraw, scheduleDraw } = createDrawLoop({ page: "souvenirs", draw, setNotice });

/**
 * 変更を保存して描き直す。
 *
 * 順序が意味を持つ: 検査 → 下書きへ書く → 反映。saveLocal が投げたら state も
 * 画面も動かない ── 保存できていないのに画面だけ新しい、という食い違いを作らない。
 */
function apply(next, focusKeyOverride) {
  try {
    validateSouvenirs(next);
    state.data = sync.saveLocal(next);
  } catch (error) {
    console.error("souvenirs: 保存できませんでした", error);
    setNotice(
      error instanceof DataError
        ? `この内容では保存できません。${error.message}`
        : `保存に失敗しました。${error?.message ?? String(error)}`
    );
    return;
  }
  publishUI?.refreshDirty();
  // 即時ではなく予約する。apply() は入力欄の change からも呼ばれるため
  scheduleDraw("お土産リストの保存", focusKeyOverride);
}

/** id で 1 行を引く。見つからなければ null。 */
const find = (id) => state.data.items.find((i) => i.id === id) ?? null;

const handlers = {
  onToggle(id, bought) {
    const item = find(id);
    if (!item) return;
    apply(withSouvenir(state.data, { ...item, bought }));
  },
  onEdit(id, patch) {
    const item = find(id);
    if (!item) return;
    // 併合であって置き換えではない。patch に無いキーを落とさない
    apply(withSouvenir(state.data, { ...item, ...patch }));
  },
  onDelete(id) {
    apply(withoutSouvenir(state.data, id));
  },
};

function buildToolbar() {
  const label = el("span", null, "リストを編集");
  els.editToggle.innerHTML = icon("i-edit", "ico--sm");
  els.editToggle.appendChild(label);
  els.editToggle.addEventListener("click", () => {
    state.editing = !state.editing;
    els.editToggle.setAttribute("aria-pressed", String(state.editing));
    label.textContent = state.editing ? "編集を終える" : "リストを編集";
    els.add.hidden = !state.editing;
    safeDraw("編集モードの切り替え");
  });

  els.add.innerHTML = icon("i-plus", "ico--sm");
  els.add.appendChild(el("span", null, "お土産を追加"));
  els.add.addEventListener("click", () => {
    // このボタンは #sv-table の外（ツールバー）にいて draw() では作り直されない。
    // 明示的に新しい行の「何を」の欄へ送らないと、既存の行を全部タブで
    // 飛び越さないと辿り着けない
    const id = nextSouvenirId(state.data.items);
    apply(
      withSouvenir(state.data, {
        id,
        name: "新しいお土産",
        recipient: "",
        shop: "",
        note: "",
        bought: false,
      }),
      souvenirFocusKey(id, "name")
    );
  });

  els.editToggle.disabled = false;
  els.add.disabled = false;
  els.add.hidden = true;
}

function showLoadError(error) {
  const { message } = classifyLoadError(error, SUBJECT);
  els.table.innerHTML = `<p class="ferror ferror--block">${escapeHtml(message)}</p>`;
}

async function main() {
  injectSprite();
  renderNav(document.getElementById("nav"), "souvenirs");

  const store = createStore();

  // 鍵が無ければ復号できない。合言葉を入れてもらうため入口へ戻す。
  // hasKey() ではなく loadCodec() の結果で判断する（形は正しいが base64 として
  // 壊れた鍵は hasKey を通り、loadCodec で null になる。schedule.js のコメント参照）
  const codec = hasKey(store) ? await loadCodec(store) : null;
  if (codec === null) {
    clearKey(store);
    location.replace("index.html");
    return;
  }

  // **6 つを揃えて渡す。** 一部だけだと旅程や持ち物の下書きが
  // お土産データで上書きされる（設計書 §13、sync.js の DEFAULT_CONFIG のコメント）
  sync = createSync({
    store,
    config: {
      ...DEFAULT_CONFIG,
      path: SUBJECT.path,
      draftKey: "souvenirs",
      baseKey: "souvenirs-base",
      validate: validateSouvenirs,
      commitMessage: (data) => {
        const count = data.items.length;
        return `Update souvenir list from the browser (${count} item${count === 1 ? "" : "s"})`;
      },
      noun: SUBJECT.noun,
      codec,
    },
  });

  publishUI = createPublishUI({
    els: {
      controls: els.pubControls,
      panel: els.pubPanel,
      status: els.pubStatus,
      bar: els.syncbar,
    },
    store,
    sync,
    getData: () => state.data,
    content: { validate: validateSouvenirs, noun: SUBJECT.noun },
    onAdopt: (data) => {
      state.data = data;
      safeDraw("リモートの取り込み");
    },
  });

  let loaded;
  try {
    loaded = await sync.load();
  } catch (error) {
    // 404 は「取れなかった」ではなく「まだ作られていない」。空のリストで始める。
    // ここを取り違えると、最初の 1 人が永久にページを開けない
    if (error?.status === 404) {
      state.data = emptySouvenirs();
      buildToolbar();
      publishUI.start("use-local");
      draw();
      return;
    }

    // リモートが壊れていても、手元に正しい下書きがあれば公開で直せる（設計書 §6.5）
    const draft = sync.readDraft();
    if (draft) {
      state.data = draft;
      publishUI.refreshDirty();
    }

    throw toLoadError(error);
  }

  state.data = loaded.data;

  if (loaded.outerStampMismatch) {
    // 封筒の外側は認証されないので、改竄も破損も GCM は気付かない。
    // 内側を正として表示しているが、黙って直すと誰も気付かないまま進む（設計書 §6.2）
    setStampNotice(
      "リモートのファイルの更新時刻が中身と食い違っています。" +
        "中身の時刻を正として表示しています。公開し直すと揃うことがあります。"
    );
  }

  buildToolbar();
  publishUI.start(loaded.source);
  draw();
}

// initReveal() は必ず走らせる。.reveal は opacity: 0 で待機しているので、
// 飛ばすとページが真っ白になる（エラーそのものも読み取れなくなる）
main()
  .catch((error) => {
    console.error(error);
    showLoadError(error);
  })
  .finally(() => {
    initReveal();
  });
```

- [ ] **Step 2: `localStorage` のキーが 1 か所にしか無いことを確かめる**

Run:
```bash
grep -rn "souvenirs-base\|\"souvenirs\"" assets/js/
```
Expected: `assets/js/souvenirs.js` の `createSync()` の `config` だけ（2 行）

- [ ] **Step 3: 全テストを流す**

Run: `node --test`
Expected: PASS。**567 のまま**（エントリポイントにはテストが無いのが規約）

- [ ] **Step 4: コミット**

```bash
git add assets/js/souvenirs.js
git commit -m "Wire the souvenir page up, starting from nothing"
```

---

## Task 8: メニューとナビに 3 つ目を足す

**Files:**
- Modify: `assets/js/nav.js`（`PAGES` 定数）
- Modify: `assets/js/menu.js`（`CARDS` 定数）
- Modify: `tests/renderers.test.js`（`renderNav` のテスト群）

- [ ] **Step 1: `tests/renderers.test.js` の `renderNav` のテストを 3 ページ分に直す**

既存の 2 つのテストを次に置き換える:

```javascript
test("renderNav: 3 ページ分のリンクとホームを出す", () => {
  const html = navHtml(null);
  for (const href of ["index.html", "schedule.html", "packing.html", "souvenirs.html"]) {
    assert.ok(html.includes(`href="${href}"`), `${href} へのリンクがありません`);
  }
  // nav__links（囲みの div）に釣られないよう、直後の文字まで見る
  assert.equal(html.match(/class="nav__link[" ]/g).length, 3);
});
```

`renderNav: current を変えると付く位置も変わる` の配列に 1 行足す:

```javascript
  for (const [key, href] of [
    ["schedule", "schedule.html"],
    ["packing", "packing.html"],
    ["souvenirs", "souvenirs.html"],
  ]) {
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node --test tests/renderers.test.js`
Expected: FAIL（リンクが無い／`nav__link` が 2 つしかない）

- [ ] **Step 3: `assets/js/nav.js` の `PAGES` に足す**

```javascript
const PAGES = [
  { key: "schedule", href: "schedule.html", label: "旅程", ico: "i-calendar" },
  { key: "packing", href: "packing.html", label: "持ち物", ico: "i-luggage" },
  { key: "souvenirs", href: "souvenirs.html", label: "お土産", ico: "i-shop" },
];
```

`i-shop` は既に `ICON_IDS` にある（`assets/js/icons.js:105`）。**新しいアイコンを足す必要は無い。**

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test tests/renderers.test.js`
Expected: PASS

- [ ] **Step 5: `assets/js/menu.js` の `CARDS` に 3 枚目を足す**

`CARDS` 配列の末尾（`packing.html` のカードの後ろ）に足す:

```javascript
  {
    href: "souvenirs.html",
    eyebrow: "Souvenirs",
    title: "お土産リスト",
    ico: "i-shop",
    desc: "何を、誰に、どこで買うか。買ったものはチェックできます。",
    image:
      "https://www.thailandtravel.or.jp/wp-content/uploads/2017/03/01871-808x538.jpg",
  },
```

**画像は暫定で持ち物と同じものを指している。** 別の写真に差し替えたい場合は
`https:` のどのホストでもよい（CSP の `img-src` が `https:` のワイルドカード）。
差し替えは Task 9 の後でも独立して行える。

- [ ] **Step 6: 全テストを流す**

Run: `node --test`
Expected: PASS。**567 のまま**（テストの本数は変わらず、中身が 3 ページ分になる）

- [ ] **Step 7: ブラウザで通しで確かめる**

```bash
python3 -m http.server 8000
```

1. トップページにカードが **3 枚**並ぶ
2. 「お土産リスト」を押す → ページが開き、**空のリストの案内**が出る（`souvenirs.json` はまだ無いので 404 → 空）
3. ツールバーに「リストを編集」と、トークンまわりのボタンが出ている
4. 「リストを編集」→「お土産を追加」→ **1 度目で行が増え、「何を」の欄にフォーカスがある**
5. 「何を」に文字を打って **すぐに**「お土産を追加」を押す → 2 行目が 1 度で増える（`scheduleDraw` の確認）
6. 「どこで」に店名を入れ、2 行目の「どこで」を選ぶと**候補に出る**
7. 「買った」のチェックを押す → 進捗の数字とバーが動く
8. 「編集を終える」→ チェックは**まだ押せる**、入力欄と ✕ は消えている
9. ✕ を 1 度押して身構え、2 度目で消える
10. タブを閉じて開き直す → **下書きが残っている**
11. ナビの「旅程」「持ち物」を押す → **どちらも壊れていない**（下書きキーの取り違えが起きていないことの確認。ここが壊れていたら `createSync()` の 6 つを疑う）

- [ ] **Step 8: コミット**

```bash
git add assets/js/nav.js assets/js/menu.js tests/renderers.test.js
git commit -m "Put the souvenir list on the menu and in the nav"
```

---

## Task 9: ドキュメントを実態に合わせる

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/handoff/2026-08-10.md`
- Modify: `docs/spec/travel-plans-redesign.md`（フェーズ表の状態だけ）

- [ ] **Step 1: `CLAUDE.md` を直す**

1. 「ファイル構成」の図に足す:
   - `assets/css/souvenirs.css`
   - `assets/js/page-notice.js` / `focus-key.js` / `souvenirs-validate.js` / `souvenirs-data.js` / `souvenirs-render.js` / `souvenirs.js`
   - `assets/data/souvenirs.json`
2. 冒頭の「実装済み」の記述を **4 ページ**に直す（`index.html / schedule.html / packing.html / souvenirs.html`）
3. 「保存と公開」の `localStorage` キーの表に 2 行足す:

```markdown
| `tp:souvenirs` | お土産リストの下書き（`souvenirs.json` と同じ形＋`updatedAt`。平文のまま） | `souvenirs.js` が `createSync()` に渡す `config`（Phase B5 で追加） |
| `tp:souvenirs-base` | お土産リストを最後にリモートと揃えた時点の `updatedAt` 文字列 | 同上 |
```

   同じ節の「使うのは 6 つ」を **8 つ**に直す。
4. 「Content-Security-Policy」の節の「3 ページ」を **4 ページ**に直す（`tests/csp.test.js` の説明も）
5. 「テスト」の節に Phase B5 で足したテストの一覧を書く
6. 「新しいカテゴリを追加」の末尾にある**色リテラル検査のリストの警告**に、`souvenirs.css` を足した実績を追記する

- [ ] **Step 2: `README.md` を直す**

1. 「機能」に「お土産リスト（何を・誰に・どこで買うか）」を足す
2. 「3 ページとも実装済み」を **4 ページ**に直す
3. 「プロジェクト構成」の図に上記のファイルを足す
4. 「保存と公開」の下書きキーの説明に `tp:souvenirs` を足す
5. 末尾の「最終更新」を `date +%F` の日付に更新する

- [ ] **Step 3: `docs/README.md` の plans 表に 1 行足す**

```markdown
| [`phase-b5-souvenirs.md`](plans/phase-b5-souvenirs.md) | ページ共通部品の抽出とお土産リスト | 完了 |
```

「次は Phase B5」と書いてある段落を「次は Phase B3（コメント）」に直す。

- [ ] **Step 4: `docs/spec/travel-plans-redesign.md` のフェーズ表を直す**

B5 の行の状態を `**次はここ**（2026-08-10 追加）` から `**完了**（`date +%F` の日付）` に、B3 の行を `B5 のあと` から `**次はここ**` に変える。

§13 の 2 項目（60 行の重複／フォーカスキー）に、**解消済みであることを追記する**（消さない ── なぜその形になったのかの記録は残す）:

```markdown
  **→ B5 で解消した。** `assets/js/page-notice.js` に `createNotices()` と
  `createDrawLoop()` を置き、`toLoadError()` を `load-error.js` へ足して、
  3 ページがそれを呼ぶ形にした（YYYY-MM-DD）。
```

```markdown
  **→ B5 で解消した。** `assets/js/focus-key.js` の `itemFocusKey()` /
  `groupFocusKey()` / `souvenirFocusKey()` を両側が呼ぶ形にした（YYYY-MM-DD）。
```

`YYYY-MM-DD` は**そのコミットを打つ日**に置き換える（`date +%F` の出力）。

- [ ] **Step 5: `docs/handoff/2026-08-10.md` を直す**

「現在地」の表に B5 の完了を足し、テスト件数を実測値に更新する。「残タスク」の第 2 群（Phase B3）が次であることを確かめる。

**お土産ページの実機確認の手順**を、持ち物リストの節と同じ形で足す（Task 8 の Step 7 の 11 項目をそのまま使う）。

- [ ] **Step 6: 記述と実態が合っていることを機械的に確かめる**

```bash
# ドキュメントが挙げているファイルが実在するか
grep -rhoE '`(docs|assets|tests)/[A-Za-z0-9._/-]+`' README.md CLAUDE.md docs/README.md \
  | tr -d '`' | sort -u | while IFS= read -r p; do [ -e "$p" ] || echo "MISSING: $p"; done
# Markdown の相対リンクが切れていないか
grep -rn "](\./" README.md CLAUDE.md docs/README.md
```
Expected: `MISSING:` が出ない（`assets/js/comments.js` と `assets/data/comments.json` は B3 の予定なので、出たら記述が「予定」と読めるかを確認する）

- [ ] **Step 7: 全テストを流す**

Run: `node --test`
Expected: PASS（567）

- [ ] **Step 8: コミット**

```bash
git add CLAUDE.md README.md docs/
git commit -m "Record what B5 changed, and mark the two debts it paid off"
```

---

## 完了の定義

- [ ] `node --test` が **567 pass / 0 fail**
- [ ] ブラウザで Task 8 Step 7 の 11 項目すべてを通した
- [ ] **旅程ページと持ち物ページが壊れていない**（Task 1 Step 12 と Task 8 Step 7-11）
- [ ] `grep` で `souvenirs` の `localStorage` キーが `souvenirs.js` の 1 か所だけにある
- [ ] `souvenirs.css` に色リテラルが無いことを、検査が**実際に落ちること**で確かめた（Task 6 Step 6）
- [ ] 設計書 §2.3 のフェーズ表と §13 の 2 項目が実態に合っている

## この計画が扱わないこと

- **並べ替え**（ドラッグ、↑↓）── 階層が無いので「区分をまたぐ移動」が存在せず、持ち物にそれが要った理由が消える（設計書 §4.5）。追加は末尾
- **予算・金額・個数** ── 2026-08-10 に範囲から外した。通貨（THB / JPY）の扱いを決める必要が生まれ、「何を・誰に・どこで分かればいい」という要件を超える
- **旅程の買物スポットとの連携** ── 2 つの JSON が相互に依存し、旅程からその予定を消した瞬間にお土産側の参照が迷子になる（設計書 §7.6）。表記の揺れは `datalist` の候補で防ぐ
- **お土産の絞り込み・並べ替え表示** ── 件数が数十のうちは目で追える。要るようになってから足す
