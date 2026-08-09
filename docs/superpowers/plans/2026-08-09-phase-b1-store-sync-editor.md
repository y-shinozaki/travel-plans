# Phase B1: 保存基盤・公開フロー・予定エディタ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旅程を UI から編集し、その結果を「公開」ボタン一つで GitHub のリポジトリへ書き戻せるようにする。同行者はページを開くだけで最新を受け取る。

**Architecture:** 編集は即座に localStorage へ入る（下書き）。リポジトリの `assets/data/events.json` が正で、公開すると GitHub Contents API 経由でそれが更新される。副作用のあるコード（`fetch`、`localStorage`、DOM）と判断ロジックを分け、判断側は `node --test` で検証する。

**Tech Stack:** バニラ JS（ES モジュール）、GitHub Contents API、`node --test`（依存ゼロ）

**参照資料:**
- 設計書: `docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md`（§5 保存と共有、§4.1 スキーマ、§13 Phase A からの繰り越し）
- Phase A の計画: `docs/superpowers/plans/2026-08-09-phase-a-design-system-and-schedule.md`
- 予定エディタの UI 見本: `docs/design-reference/mock-aman.html` の 05 セクションと `#evSheet`（検証済み）
- `CLAUDE.md` — 現行アーキテクチャ

---

## Global Constraints

- **npm パッケージを追加しない。** ビルドステップを作らない。`package.json` は `"type": "module"` のみ
- **`alert()` / `confirm()` / `prompt()` を使わない。** 破壊的操作は 2 度押し、エラーはインライン表示
- **色は `assets/css/tokens.css` の変数のみ。** 角丸は `--r-*` トークンのみ
- **大文字化は 10〜12px・字間 1.2〜2px のミクロラベルとコントロールのみ**
- **`innerHTML` にイベント由来の文字列をそのまま入れない。** 平文は `dom.js` の `el()`（`textContent`）、やむを得ない場合は `escapeHtml()`。URL は必ず `safeHttpUrl()`
- UI 文言・コード内コメントは日本語
- `<script type="module">`。動作確認は `python3 -m http.server 8000` 経由のみ
- `node --test` で全テストが通ること
- コミットメッセージ本文は英語、末尾に
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

### このフェーズ固有の不変条件

- **エディタが作るデータは必ず `validateEvents()` を通る。** 通らないものを保存できてしまうと、
  次回読み込み時にページが起動しない。**これはテストで機械的に守る**（Task 8）
- **公開前に必ず検証する。** 壊れたデータをリポジトリへ push すると、同行者のページが壊れる
- **トークンはコードにもリポジトリにも書かない。** UI から入力し、その端末の
  `localStorage["tp:gh-token"]` にのみ保存する

---

## File Structure

| ファイル | 責務 |
|---|---|
| `assets/js/store.js` | localStorage ラッパ。名前空間、JSON 入出力、壊れた値と容量超過の扱い |
| `assets/js/base64.js` | UTF-8 文字列 ⇄ base64。`btoa` は日本語で例外になるため専用に切る |
| `assets/js/sync-decide.js` | ローカルとリモートのどちらを採るかの判断（純粋関数） |
| `assets/js/github.js` | GitHub Contents API の呼び出し（取得・公開）。I/O のみ |
| `assets/js/token.js` | トークンの保存・削除・有無の判定 |
| `assets/js/sync.js` | 上記を束ねて schedule.js に見せる窓口 |
| `assets/js/event-form.js` | 予定フォームの HTML 生成、値の読み出し、入力検証 |
| `assets/css/controls.css` | 追記のみ（通知バー、公開ボタンの状態） |
| `assets/js/schedule.js` | 結線（既存を改修） |
| `assets/js/sheet.js` | 編集モードの追加（既存を改修） |
| `assets/js/validate.js` | `validateEvent()` を切り出して公開（既存を改修） |
| `packing.html` / `archive.html` | インライン module を外部ファイルへ |
| `assets/js/stub-page.js` | スタブ 2 ページ共通のエントリポイント |
| `tests/*.test.js` | 各純粋モジュールのテスト |

---

## Task 1: CSP を入れ、インライン script をなくす

**Files:**
- Create: `assets/js/stub-page.js`
- Modify: `packing.html`, `archive.html`（インライン module を外部化）
- Modify: `index.html`, `schedule.html`, `packing.html`, `archive.html`（CSP を追加）
- Test: `tests/csp.test.js`

**Interfaces:**
- Consumes: `injectSprite`（`icons.js`）、`renderNav`（`nav.js`）
- Produces: なし（HTML の静的な性質のみ）

トークンをブラウザに置く前に入れる。`script-src 'self'` は `javascript:` URL も止めるので、
`safeHttpUrl()` の二重の防御になる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/csp.test.js`。HTML をテキストとして読み、静的に検査する。ブラウザ不要。

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = ["index.html", "schedule.html", "packing.html", "archive.html"];

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

function cspOf(html) {
  const m = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i.exec(html);
  return m ? m[1] : null;
}

function directive(csp, name) {
  const found = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + " "));
  return found ? found.slice(name.length + 1).trim().split(/\s+/) : null;
}

test("全ページに CSP がある", () => {
  for (const page of PAGES) {
    assert.ok(cspOf(read(page)), `${page} に CSP メタタグがありません`);
  }
});

test("script-src は self のみ。unsafe-inline も unsafe-eval も許さない", () => {
  for (const page of PAGES) {
    const src = directive(cspOf(read(page)), "script-src");
    assert.deepEqual(src, ["'self'"], `${page} の script-src が想定と違います`);
  }
});

test("インライン script が 1 つもない", () => {
  // script-src 'self' の下ではインライン script は実行されない。
  // 書いてあること自体が「動かないコードが残っている」印なので落とす。
  for (const page of PAGES) {
    const html = read(page);
    for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attrs, body] = tag;
      assert.match(attrs, /\bsrc=/, `${page} にインライン script があります: ${body.trim().slice(0, 60)}`);
      assert.equal(body.trim(), "", `${page} の script タグに中身があります`);
    }
  }
});

test("イベントハンドラ属性が 1 つもない", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${page} に on* 属性があります`);
  }
});

test("connect-src が GitHub API を許可している", () => {
  // 公開フローが api.github.com を叩く
  for (const page of PAGES) {
    const c = directive(cspOf(read(page)), "connect-src");
    assert.ok(c?.includes("https://api.github.com"), `${page} の connect-src に api.github.com がありません`);
  }
});

test("地図タイルとフォントの取得元が許可されている", () => {
  const csp = cspOf(read("schedule.html"));
  // img-src は https: のワイルドカードで許可している（旅程データが複数の
  // 外部ホストから画像を直リンクしているため。設計書 §13 の負債）。
  // ホスト名を列挙する形に変えたなら、その並びに CartoDB が入っていること。
  const img = directive(csp, "img-src");
  assert.ok(
    img?.includes("https:") || img?.some((s) => s.includes("cartocdn.com")),
    `img-src が地図タイルを許可していません: ${img?.join(" ")}`
  );
  assert.ok(directive(csp, "font-src")?.some((s) => s.includes("fonts.gstatic.com")));
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/csp.test.js`
Expected: FAIL。CSP メタタグがなく、`packing.html` / `archive.html` にインライン module がある。

- [ ] **Step 3: スタブページのエントリポイントを外部化する**

`assets/js/stub-page.js`:

```js
/**
 * packing.html と archive.html の共通エントリポイント。
 * CSP で script-src 'self' にしたため、インライン module は使えない。
 * どちらのページかは <body data-page="..."> から取る。
 */
import { injectSprite } from "./icons.js";
import { renderNav } from "./nav.js";

try {
  injectSprite();
  renderNav(document.getElementById("nav"), document.body.dataset.page ?? null);
} catch (error) {
  console.error("ページの初期化に失敗しました", error);
}
```

`packing.html` と `archive.html` の `<body>` に `data-page="packing"` / `data-page="archive"` を付け、
インラインの `<script type="module">` ブロックを次に差し替える:

```html
    <script type="module" src="assets/js/stub-page.js"></script>
```

- [ ] **Step 4: 4 ページすべてに CSP を入れる**

`<head>` の先頭付近（`<meta name="viewport">` の直後）に置く。**4 ページで同一の内容にすること。**

```html
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
```

注意:
- `frame-ancestors` は `<meta>` では無視されるため書かない
- `img-src` を `https:` と広く取っているのは、旅程データが外部ホストの画像を直リンクしているため。
  設計書 §13 に記録済みの負債で、このフェーズでは変えない

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `node --test tests/csp.test.js`
Expected: PASS。6 件すべて成功。

- [ ] **Step 6: ブラウザで確認する**

`python3 -m http.server 8000` を起動し、4 ページすべてを開く。

**CSP 違反はコンソールに `Refused to ...` として出る。1 件でも出たら直すこと。** 特に確認:
- 4 ページともコンソールに CSP 違反がない
- `schedule.html` で地図タイルが表示される
- Google Fonts が適用されている（見出しがセリフ体になっている）
- スタブ 2 ページのナビが描画され、`aria-current` が付いている

サーバーを停止する。

- [ ] **Step 7: コミット**

```bash
git add tests/csp.test.js assets/js/stub-page.js index.html schedule.html packing.html archive.html
git commit -m "$(cat <<'EOF'
Add a Content-Security-Policy and remove the inline scripts

script-src 'self' also blocks javascript: URLs, which makes this a
second layer under safeHttpUrl(). Landing it before Phase B stores a
repo-write token is cheaper than auditing the token flow afterwards.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `store.js` — localStorage ラッパ

**Files:**
- Create: `assets/js/store.js`
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `createStore(backend = globalThis.localStorage)` → `{ read(key, fallback), write(key, value), remove(key), has(key) }`
  - キーは `tp:` 名前空間を自動で付ける。呼び出し側は `"events"` と書く

`backend` を差し替えられるようにするのは、Node でテストするため。`localStorage` を直接触ると
テストが書けない。

- [ ] **Step 1: 失敗するテストを書く**

`tests/store.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../assets/js/store.js";

function memoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

test("キーに tp: の名前空間が付く", () => {
  const backend = memoryBackend();
  createStore(backend).write("events", { a: 1 });
  assert.deepEqual(Object.keys(backend._dump()), ["tp:events"]);
});

test("書いた値がそのまま読める", () => {
  const store = createStore(memoryBackend());
  const value = { days: [{ dow: "水" }], events: [] };
  store.write("events", value);
  assert.deepEqual(store.read("events", null), value);
});

test("日本語と絵文字が壊れない", () => {
  const store = createStore(memoryBackend());
  store.write("x", { t: "ワット アルン 🛕" });
  assert.equal(store.read("x", null).t, "ワット アルン 🛕");
});

test("未設定のキーは fallback を返す", () => {
  const store = createStore(memoryBackend());
  assert.equal(store.read("nope", "既定値"), "既定値");
});

test("壊れた JSON は fallback を返し、例外を投げない", () => {
  // 手で localStorage をいじった、別バージョンが書いた、などで起きうる。
  // ここで throw するとページ全体が起動しなくなるので、握って既定値に戻す。
  const store = createStore(memoryBackend({ "tp:events": "{ぐちゃぐちゃ" }));
  assert.equal(store.read("events", "既定値"), "既定値");
});

test("壊れた JSON を読んだことは警告として残る", () => {
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(" "));
  try {
    createStore(memoryBackend({ "tp:events": "{" })).read("events", null);
  } finally {
    console.warn = original;
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0], /tp:events/);
});

test("has は存在の有無を返す", () => {
  const store = createStore(memoryBackend({ "tp:a": '"x"' }));
  assert.equal(store.has("a"), true);
  assert.equal(store.has("b"), false);
});

test("remove で消える", () => {
  const store = createStore(memoryBackend({ "tp:a": '"x"' }));
  store.remove("a");
  assert.equal(store.has("a"), false);
});

test("容量超過は StoreWriteError として投げ直す", () => {
  // 黙って失敗すると「保存したつもり」で編集が消える。呼び出し側が気づける形にする。
  const backend = memoryBackend();
  backend.setItem = () => {
    const e = new Error("quota");
    e.name = "QuotaExceededError";
    throw e;
  };
  assert.throws(() => createStore(backend).write("events", { a: 1 }), /保存できませんでした/);
});

test("localStorage が使えない環境でも生成自体は成功する", () => {
  // プライベートブラウジングなどで getItem が throw することがある
  const hostile = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => {},
  };
  const store = createStore(hostile);
  assert.equal(store.read("a", "既定値"), "既定値");
  assert.equal(store.has("a"), false);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/store.test.js`
Expected: FAIL。`Cannot find module .../assets/js/store.js`。

- [ ] **Step 3: 実装する**

`assets/js/store.js`:

```js
/**
 * localStorage の薄いラッパ。
 *
 * backend を差し替えられるようにしてあるのは Node でテストするため。
 * 直接 localStorage を触ると、この層のテストが書けない。
 *
 * 読み出しは「壊れていても落とさない」、書き込みは「失敗したら必ず知らせる」方針。
 * 読めない値は既定値に戻せば動き続けられるが、書けなかったことを黙って握ると
 * ユーザーは保存できたと思ったまま編集を失う。
 */

const PREFIX = "tp:";

export class StoreWriteError extends Error {
  constructor(key, cause) {
    super(`${key} を保存できませんでした（保存領域の空きが足りない可能性があります）`);
    this.name = "StoreWriteError";
    this.cause = cause;
  }
}

export function createStore(backend = globalThis.localStorage) {
  const fullKey = (key) => PREFIX + key;

  function read(key, fallback) {
    let raw;
    try {
      raw = backend.getItem(fullKey(key));
    } catch (error) {
      console.warn(`${fullKey(key)} を読めませんでした`, error);
      return fallback;
    }
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`${fullKey(key)} の中身が壊れていたため既定値に戻します`, error);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      backend.setItem(fullKey(key), JSON.stringify(value));
    } catch (error) {
      throw new StoreWriteError(fullKey(key), error);
    }
  }

  function remove(key) {
    try {
      backend.removeItem(fullKey(key));
    } catch (error) {
      console.warn(`${fullKey(key)} を削除できませんでした`, error);
    }
  }

  function has(key) {
    try {
      return backend.getItem(fullKey(key)) != null;
    } catch {
      return false;
    }
  }

  return { read, write, remove, has };
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/store.test.js`
Expected: PASS。10 件すべて成功。

- [ ] **Step 5: コミット**

```bash
git add assets/js/store.js tests/store.test.js
git commit -m "$(cat <<'EOF'
Add a localStorage wrapper

Reads degrade to a fallback so a corrupted value cannot stop the page
booting; writes throw, because silently losing an edit the user
believes was saved is worse than an error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `base64.js` — UTF-8 の base64 変換

**Files:**
- Create: `assets/js/base64.js`
- Test: `tests/base64.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `toBase64Utf8(text): string`、`fromBase64Utf8(b64): string`

GitHub Contents API はファイル内容を base64 で受け取る。**`btoa(JSON.stringify(data))` は
日本語で例外になる**（`btoa` は Latin-1 しか扱えない）。旅程データは日本語だらけなので、
ここを間違えると公開機能が常に失敗する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/base64.test.js`:

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/base64.test.js`
Expected: FAIL。`Cannot find module .../assets/js/base64.js`。

- [ ] **Step 3: 実装する**

`assets/js/base64.js`:

```js
/**
 * UTF-8 文字列 ⇄ base64。
 *
 * GitHub Contents API はファイル内容を base64 で受け取る。
 * btoa() は Latin-1 しか扱えず、日本語を渡すと InvalidCharacterError になる。
 * 旅程データは日本語だらけなので、専用に切ってある。
 *
 * バイト列を 1 文字ずつ足すのは、String.fromCharCode(...bytes) だと
 * 引数が多すぎて長い入力で RangeError になるため。
 */

export function toBase64Utf8(text) {
  if (typeof text !== "string") {
    throw new TypeError(`toBase64Utf8: 文字列ではありません: ${typeof text}`);
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64Utf8(b64) {
  if (typeof b64 !== "string") {
    throw new TypeError(`fromBase64Utf8: 文字列ではありません: ${typeof b64}`);
  }
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/base64.test.js`
Expected: PASS。7 件すべて成功。

- [ ] **Step 5: コミット**

```bash
git add assets/js/base64.js tests/base64.test.js
git commit -m "$(cat <<'EOF'
Add UTF-8 safe base64 helpers

btoa() throws on Japanese text, and the itinerary is full of it, so
publishing would fail every time without this.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `sync-decide.js` — どちらを採るかの判断

**Files:**
- Create: `assets/js/sync-decide.js`
- Test: `tests/sync-decide.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `decideSync({ remoteUpdatedAt, localUpdatedAt, baseUpdatedAt, hasLocal })` →
  `"use-remote" | "use-local" | "remote-is-newer" | "offline"`

設計書 §5.2 の分岐をそのまま純粋関数にする。I/O を含めないので、全分岐をテストできる。

判断の意味:

| 戻り値 | 意味 | 画面での扱い |
|---|---|---|
| `use-remote` | ローカルに何もない、またはリモートを取り込むべき | そのまま描画 |
| `use-local` | ローカルが最新（未公開の変更を含む） | そのまま描画 |
| `remote-is-newer` | リモートが進んでいて、ローカルに未公開の変更もある | バーを出して選ばせる |
| `offline` | リモートを取得できなかった | ローカルで動かし、注意書きを出す |

- [ ] **Step 1: 失敗するテストを書く**

`tests/sync-decide.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { decideSync } from "../assets/js/sync-decide.js";

const T1 = "2026-08-09T10:00:00+09:00";
const T2 = "2026-08-09T12:00:00+09:00";
const T3 = "2026-08-09T14:00:00+09:00";

test("ローカルに何もなければリモートを使う", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: null, baseUpdatedAt: null, hasLocal: false }),
    "use-remote"
  );
});

test("リモートが取れなければ offline", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: null, localUpdatedAt: T1, baseUpdatedAt: T1, hasLocal: true }),
    "offline"
  );
});

test("リモートが取れずローカルもなければ offline", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: null, localUpdatedAt: null, baseUpdatedAt: null, hasLocal: false }),
    "offline"
  );
});

test("リモートが取り込んだ時点と同じならローカルを使う", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: T2, baseUpdatedAt: T1, hasLocal: true }),
    "use-local"
  );
});

test("リモートが進んでいて、ローカルに未公開の変更がなければ静かに取り込む", () => {
  // localUpdatedAt === baseUpdatedAt なら、ローカルは取り込んだまま触られていない
  assert.equal(
    decideSync({ remoteUpdatedAt: T2, localUpdatedAt: T1, baseUpdatedAt: T1, hasLocal: true }),
    "use-remote"
  );
});

test("リモートが進んでいて、ローカルにも未公開の変更があれば選ばせる", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: T3, localUpdatedAt: T2, baseUpdatedAt: T1, hasLocal: true }),
    "remote-is-newer"
  );
});

test("リモートが古い場合はローカルを使う", () => {
  // 自分が公開した直後に Pages の反映が追いつかず、古い版が返ることがある
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: T3, baseUpdatedAt: T3, hasLocal: true }),
    "use-local"
  );
});

test("base がないのにローカルがある場合は未公開の変更として扱う", () => {
  // 取り込み前に編集した、base を消した、などの異常系。
  // 黙ってリモートで上書きすると編集が消えるので、選ばせる側に倒す。
  assert.equal(
    decideSync({ remoteUpdatedAt: T2, localUpdatedAt: T1, baseUpdatedAt: null, hasLocal: true }),
    "remote-is-newer"
  );
});

test("不正な日時は remote-is-newer に倒す", () => {
  // 比較できない以上、黙って上書きするより人に決めさせる
  assert.equal(
    decideSync({ remoteUpdatedAt: "いつか", localUpdatedAt: T1, baseUpdatedAt: T1, hasLocal: true }),
    "remote-is-newer"
  );
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/sync-decide.test.js`
Expected: FAIL。`Cannot find module .../assets/js/sync-decide.js`。

- [ ] **Step 3: 実装する**

`assets/js/sync-decide.js`:

```js
/**
 * ローカルの下書きとリモートの正、どちらを採るかを決める。
 *
 * I/O を持たないのは、全分岐をテストで押さえるため。
 * 迷ったときは「人に選ばせる」側に倒す。黙ってリモートで上書きすると
 * 同行者が手元で付けた変更が消えるため。
 *
 * 設計書 §5.2 に対応。
 */

function toTime(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function decideSync({ remoteUpdatedAt, localUpdatedAt, baseUpdatedAt, hasLocal }) {
  if (remoteUpdatedAt == null) return "offline";
  if (!hasLocal) return "use-remote";

  const remote = toTime(remoteUpdatedAt);
  const local = toTime(localUpdatedAt);
  const base = toTime(baseUpdatedAt);

  // 比較できないなら人に決めさせる
  if (remote == null || local == null) return "remote-is-newer";

  // リモートが進んでいない
  if (remote <= (base ?? remote)) return "use-local";
  if (base == null) return "remote-is-newer";
  if (remote <= base) return "use-local";

  // ここから先はリモートが base より新しい。ローカルが触られているかで分かれる
  return local > base ? "remote-is-newer" : "use-remote";
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/sync-decide.test.js`
Expected: PASS。9 件すべて成功。

- [ ] **Step 5: コミット**

```bash
git add assets/js/sync-decide.js tests/sync-decide.test.js
git commit -m "$(cat <<'EOF'
Add the local-vs-remote decision as a pure function

Every branch is reachable from a test because there is no I/O here.
Ambiguous cases resolve to "ask the human" rather than overwriting,
since a silent adopt discards a travelling companion's edits.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `github.js` — Contents API の呼び出し

**Files:**
- Create: `assets/js/github.js`
- Test: `tests/github.test.js`

**Interfaces:**
- Consumes: `toBase64Utf8`（`base64.js`）
- Produces:
  - `createGitHub({ owner, repo, branch, token, fetchImpl = fetch })` →
    `{ getFile(path), putFile({ path, text, sha, message }) }`
  - `getFile` → `{ sha, text }` または `null`（404 のとき）
  - `putFile` → `{ sha, commitUrl }`
  - 失敗時は `GitHubError`（`status` と人向けの `message` を持つ）

`fetchImpl` を差し替えられるようにして、Node で全応答パターンをテストする。

- [ ] **Step 1: 失敗するテストを書く**

`tests/github.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createGitHub, GitHubError } from "../assets/js/github.js";
import { toBase64Utf8 } from "../assets/js/base64.js";

const CONF = { owner: "y-shinozaki", repo: "travel-plans", branch: "main", token: "tkn" };

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  impl.calls = calls;
  return impl;
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("getFile は sha と本文を返す", async () => {
  const impl = fakeFetch(() => json(200, { sha: "abc123", content: toBase64Utf8('{"a":1}') }));
  const gh = createGitHub({ ...CONF, fetchImpl: impl });
  assert.deepEqual(await gh.getFile("assets/data/events.json"), { sha: "abc123", text: '{"a":1}' });
});

test("getFile は日本語を正しく復号する", async () => {
  const body = '{"title":"ワット アルン"}';
  const impl = fakeFetch(() => json(200, { sha: "s", content: toBase64Utf8(body) }));
  const gh = createGitHub({ ...CONF, fetchImpl: impl });
  assert.equal((await gh.getFile("x")).text, body);
});

test("GitHub が改行入りの base64 を返しても復号できる", async () => {
  // Contents API は 60 文字ごとに改行を挟むことがある
  const body = '{"a":1}';
  const wrapped = toBase64Utf8(body).replace(/(.{4})/g, "$1\n");
  const impl = fakeFetch(() => json(200, { sha: "s", content: wrapped }));
  const gh = createGitHub({ ...CONF, fetchImpl: impl });
  assert.equal((await gh.getFile("x")).text, body);
});

test("getFile は 404 のとき null を返す", async () => {
  const impl = fakeFetch(() => json(404, { message: "Not Found" }));
  const gh = createGitHub({ ...CONF, fetchImpl: impl });
  assert.equal(await gh.getFile("nope.json"), null);
});

test("認証ヘッダとブランチが付く", async () => {
  const impl = fakeFetch(() => json(200, { sha: "s", content: toBase64Utf8("{}") }));
  await createGitHub({ ...CONF, fetchImpl: impl }).getFile("assets/data/events.json");
  const { url, init } = impl.calls[0];
  assert.match(url, /repos\/y-shinozaki\/travel-plans\/contents\/assets\/data\/events\.json/);
  assert.match(url, /ref=main/);
  assert.equal(init.headers.Authorization, "Bearer tkn");
  assert.equal(init.headers["X-GitHub-Api-Version"], "2022-11-28");
});

test("putFile は base64 と sha を送る", async () => {
  const impl = fakeFetch(() => json(200, { content: { sha: "new" }, commit: { html_url: "u" } }));
  const gh = createGitHub({ ...CONF, fetchImpl: impl });
  const result = await gh.putFile({ path: "p", text: "ワット", sha: "old", message: "m" });
  const body = JSON.parse(impl.calls[0].init.body);
  assert.equal(impl.calls[0].init.method, "PUT");
  assert.equal(body.content, toBase64Utf8("ワット"));
  assert.equal(body.sha, "old");
  assert.equal(body.branch, "main");
  assert.equal(body.message, "m");
  assert.deepEqual(result, { sha: "new", commitUrl: "u" });
});

test("新規ファイルなら sha を送らない", async () => {
  const impl = fakeFetch(() => json(201, { content: { sha: "new" }, commit: { html_url: "u" } }));
  await createGitHub({ ...CONF, fetchImpl: impl }).putFile({ path: "p", text: "x", sha: null, message: "m" });
  assert.equal("sha" in JSON.parse(impl.calls[0].init.body), false);
});

test("409 は「リモートが更新されている」と分かる形で投げる", async () => {
  const impl = fakeFetch(() => json(409, { message: "does not match" }));
  const gh = createGitHub({ ...CONF, fetchImpl: impl });
  await assert.rejects(
    () => gh.putFile({ path: "p", text: "x", sha: "stale", message: "m" }),
    (e) => e instanceof GitHubError && e.status === 409 && /取り込んで/.test(e.message)
  );
});

test("401 はトークンの問題だと分かる形で投げる", async () => {
  const impl = fakeFetch(() => json(401, { message: "Bad credentials" }));
  await assert.rejects(
    () => createGitHub({ ...CONF, fetchImpl: impl }).getFile("p"),
    (e) => e instanceof GitHubError && e.status === 401 && /トークン/.test(e.message)
  );
});

test("403 は権限不足だと分かる形で投げる", async () => {
  const impl = fakeFetch(() => json(403, { message: "Resource not accessible" }));
  await assert.rejects(
    () => createGitHub({ ...CONF, fetchImpl: impl }).putFile({ path: "p", text: "x", sha: null, message: "m" }),
    (e) => e instanceof GitHubError && e.status === 403 && /権限/.test(e.message)
  );
});

test("ネットワーク断は GitHubError になる", async () => {
  const impl = fakeFetch(() => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(
    () => createGitHub({ ...CONF, fetchImpl: impl }).getFile("p"),
    (e) => e instanceof GitHubError && e.status === 0
  );
});

test("トークンが空なら呼ぶ前に落とす", async () => {
  const impl = fakeFetch(() => json(200, {}));
  assert.throws(() => createGitHub({ ...CONF, token: "", fetchImpl: impl }), /トークン/);
  assert.equal(impl.calls.length, 0);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/github.test.js`
Expected: FAIL。`Cannot find module .../assets/js/github.js`。

- [ ] **Step 3: 実装する**

`assets/js/github.js`:

```js
/**
 * GitHub Contents API の呼び出しだけを担う層。
 *
 * fetchImpl を差し替えられるようにしてあるのは、応答パターン
 * （404 / 409 / 401 / 403 / 通信断）を Node で全部通すため。
 *
 * エラーは status と「人が読んで次に何をすればいいか分かる文言」を持たせて投げる。
 * 画面にそのまま出す前提なので、英語の生メッセージを素通しさせない。
 */
import { toBase64Utf8, fromBase64Utf8 } from "./base64.js";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export class GitHubError extends Error {
  constructor(status, message, cause) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.cause = cause;
  }
}

function explain(status, body) {
  const detail = body?.message ? `（${body.message}）` : "";
  switch (status) {
    case 401:
      return `トークンが無効です。設定し直してください${detail}`;
    case 403:
      return `権限が足りません。トークンに Contents の書き込み権限があるか確認してください${detail}`;
    case 409:
      return `リモートが更新されています。取り込んでから公開し直してください${detail}`;
    case 422:
      return `内容を受け付けてもらえませんでした${detail}`;
    default:
      return `GitHub への通信に失敗しました（HTTP ${status}）${detail}`;
  }
}

export function createGitHub({ owner, repo, branch, token, fetchImpl = fetch }) {
  if (!token) throw new Error("createGitHub: トークンがありません");

  const base = `${API}/repos/${owner}/${repo}/contents/`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };

  async function call(url, init) {
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      throw new GitHubError(0, "GitHub に接続できませんでした。通信状況を確認してください", error);
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      // 本文が JSON でないことがある。status だけで判断する
    }
    return { response, body };
  }

  async function getFile(path) {
    const url = `${base}${path}?ref=${encodeURIComponent(branch)}`;
    const { response, body } = await call(url, { method: "GET", headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new GitHubError(response.status, explain(response.status, body));
    // Contents API は base64 に改行を挟むことがある
    return { sha: body.sha, text: fromBase64Utf8(String(body.content).replace(/\s/g, "")) };
  }

  async function putFile({ path, text, sha, message }) {
    const payload = { message, content: toBase64Utf8(text), branch };
    if (sha) payload.sha = sha;

    const { response, body } = await call(`${base}${path}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new GitHubError(response.status, explain(response.status, body));
    return { sha: body.content.sha, commitUrl: body.commit.html_url };
  }

  return { getFile, putFile };
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/github.test.js`
Expected: PASS。12 件すべて成功。

- [ ] **Step 5: コミット**

```bash
git add assets/js/github.js tests/github.test.js
git commit -m "$(cat <<'EOF'
Add the GitHub Contents API client

Injecting fetch lets every response path — 404, 409, 401, 403, a
dropped connection — be exercised in Node. Errors carry a Japanese
message saying what to do next, because they are shown to the user
rather than logged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `validateEvent()` の切り出しと `event-form.js`

**Files:**
- Modify: `assets/js/validate.js`（単一イベントの検査を公開）
- Create: `assets/js/event-form.js`
- Test: `tests/event-form.test.js`

**Interfaces:**
- Consumes: `CAT_META`（`categories.js`）、`decToHHMM` / `hhmmToDec`（`time.js`）、`escapeHtml`（`dom.js`）
- Produces:
  - `validate.js` から `validateEvent(ev, dayCount, seenIds = new Set())` → `string[]`（問題の一覧。空なら妥当）
  - `event-form.js` から:
    - `emptyEvent(dayCount)` → 新規作成用のイベント
    - `eventFormHtml(ev, days)` → フォームの HTML 文字列
    - `readEventForm(getValue)` → イベントオブジェクト。`getValue(id)` は文字列を返す関数
    - `formProblems(ev, dayCount)` → `string[]`

**この分割の理由:** フォームが作った値がそのまま `validateEvents()` を通ることを、
DOM なしでテストするため。通らない値を保存できてしまうと、次回読み込みでページが起動しない。

- [ ] **Step 1: `validate.js` から単一イベントの検査を公開する**

現在 `validate.js` の内部に `checkEvent(ev, i, dayCount, seenIds, problems)` がある。
これを `export function validateEvent(ev, dayCount, seenIds = new Set()): string[]` として
公開し、既存の `validateEvents` はそれを呼ぶ形に変える。**検査の中身は変えないこと。**

既存の `tests/validate.test.js` が引き続き通ることを確認する。

- [ ] **Step 2: 失敗するテストを書く**

`tests/event-form.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { emptyEvent, eventFormHtml, readEventForm, formProblems } from "../assets/js/event-form.js";
import { validateEvents } from "../assets/js/validate.js";

const DAYS = [
  { dow: "水", date: "8/12" }, { dow: "木", date: "8/13" }, { dow: "金", date: "8/14" },
];

/** フォームの初期値を id → 文字列の表にする（描画せずに読み出しを再現する） */
function valuesOf(ev) {
  return {
    "f-title": ev.title ?? "",
    "f-cat": ev.cat,
    "f-allday": ev.allDay ? "on" : "",
    "f-sday": String(ev.startDay),
    "f-eday": String(ev.endDay),
    "f-start": ev.allDay ? "" : "09:00",
    "f-end": ev.allDay ? "" : "10:30",
    "f-loc": ev.location ?? "",
    "f-lat": ev.lat == null ? "" : String(ev.lat),
    "f-lng": ev.lng == null ? "" : String(ev.lng),
    "f-url": ev.url ?? "",
    "f-notes": ev.notes ?? "",
  };
}
const getter = (values) => (id) => values[id] ?? "";

test("emptyEvent は検査を通る形を返す", () => {
  const ev = { ...emptyEvent(DAYS.length), title: "新しい予定" };
  assert.deepEqual(formProblems(ev, DAYS.length), []);
});

test("読み出した値が検査を通る", () => {
  const values = valuesOf({ ...emptyEvent(3), title: "ワット アルン" });
  const ev = readEventForm(getter(values));
  assert.deepEqual(formProblems(ev, 3), []);
  // 単体ではなく、本番と同じ入口でも通ること
  validateEvents({ updatedAt: "2026-08-09T10:00:00+09:00", days: DAYS, events: [{ ...ev, id: "ev-x" }] });
});

test("時刻が 10 進数に変換される", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-start": "10:35", "f-end": "15:05" };
  const ev = readEventForm(getter(values));
  assert.equal(ev.start, 10 + 35 / 60);
  assert.equal(ev.end, 15 + 5 / 60);
});

test("終日なら start / end を持たない", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-allday": "on" };
  const ev = readEventForm(getter(values));
  assert.equal("start" in ev, false);
  assert.equal("end" in ev, false);
  assert.equal(ev.allDay, true);
});

test("日をまたぐ予定は end < start でも妥当", () => {
  // 8/12 15:00 → 8/14 11:00 のホテル滞在。入れ替えて「直さない」こと
  const values = {
    ...valuesOf(emptyEvent(3)),
    "f-title": "バンコクホテル", "f-sday": "0", "f-eday": "2",
    "f-start": "15:00", "f-end": "11:00",
  };
  assert.deepEqual(formProblems(readEventForm(getter(values)), 3), []);
});

test("同じ日で終了が開始以前なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-start": "14:00", "f-end": "13:00" };
  const problems = formProblems(readEventForm(getter(values)), 3);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /終了/);
});

test("タイトルが空なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-title": "  " };
  assert.match(formProblems(readEventForm(getter(values)), 3).join(), /タイトル/);
});

test("終了日が開始日より前なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-sday": "2", "f-eday": "0" };
  assert.match(formProblems(readEventForm(getter(values)), 3).join(), /終了日/);
});

test("座標は両方揃ったときだけ採る", () => {
  const only = { ...valuesOf(emptyEvent(3)), "f-lat": "13.74", "f-lng": "" };
  const ev = readEventForm(getter(only));
  assert.equal(ev.lat, null);
  assert.equal(ev.lng, null);
  assert.deepEqual(formProblems(ev, 3), []);
});

test("両方揃えば数値として採る", () => {
  const both = { ...valuesOf(emptyEvent(3)), "f-lat": "13.74", "f-lng": "100.49" };
  const ev = readEventForm(getter(both));
  assert.equal(ev.lat, 13.74);
  assert.equal(ev.lng, 100.49);
});

test("座標が数値でなければ問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-lat": "あ", "f-lng": "100" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /緯度/);
});

test("緯度の範囲外は問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-lat": "999", "f-lng": "100" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /緯度/);
});

test("http でない URL は問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-url": "javascript:alert(1)" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /URL/);
});

test("空の URL は許す", () => {
  assert.deepEqual(formProblems(readEventForm(getter(valuesOf(emptyEvent(3)))), 3), []);
});

test("前後の空白は落とす", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-title": "  ワット  ", "f-loc": " BKK " };
  const ev = readEventForm(getter(values));
  assert.equal(ev.title, "ワット");
  assert.equal(ev.location, "BKK");
});

test("フォームの HTML がタイトルをエスケープする", () => {
  const ev = { ...emptyEvent(3), title: '<img src=x onerror="alert(1)">' };
  const html = eventFormHtml(ev, DAYS);
  assert.doesNotMatch(html, /<img\s+src=x/);
  assert.doesNotMatch(html, /onerror="/);
});

test("フォームの HTML に全カテゴリの選択肢がある", () => {
  const html = eventFormHtml(emptyEvent(3), DAYS);
  for (const cat of ["cat-move", "cat-sight", "cat-food", "cat-hotel", "cat-shop"]) {
    assert.ok(html.includes(cat), `${cat} の選択肢がありません`);
  }
});

test("フォームの HTML に日数ぶんの選択肢がある", () => {
  const html = eventFormHtml(emptyEvent(3), DAYS);
  for (const d of DAYS) assert.ok(html.includes(d.date), `${d.date} の選択肢がありません`);
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `node --test tests/event-form.test.js`
Expected: FAIL。`Cannot find module .../assets/js/event-form.js`。

- [ ] **Step 4: `assets/js/event-form.js` を実装する**

満たすべき仕様（コードは実装者が書く。上のテストが仕様書）:

- `emptyEvent(dayCount)` — `cat: "cat-sight"`、`allDay: false`、`startDay: 0`、`endDay: 0`、
  `start: 9`、`end: 10`、他は空文字または `null`。`id` は持たせない（保存時に採番する）
- `eventFormHtml(ev, days)` — `docs/design-reference/mock-aman.html` の `#evSheet` の
  フォーム部分を元にする。入力欄の `id` は上のテストと一致させること。
  **すべての値を `escapeHtml()` に通す**
- `readEventForm(getValue)` — 文字列を型に直す。時刻は `hhmmToDec`。座標は両方揃ったときのみ数値、
  片方だけなら両方 `null`。文字列は `trim()`
- `formProblems(ev, dayCount)` — `validateEvent()` を呼び、加えてフォーム固有の検査
  （タイトルが空でないこと、URL が `safeHttpUrl()` を通ること）を足す。
  **`validateEvent` の規則を書き写さないこと。** 二重管理になり必ずずれる

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `node --test tests/event-form.test.js`
Expected: PASS。18 件すべて成功。あわせて `node --test` で全体が通ること。

- [ ] **Step 6: コミット**

```bash
git add assets/js/event-form.js assets/js/validate.js tests/event-form.test.js
git commit -m "$(cat <<'EOF'
Add the event form's markup, parsing and validation

formProblems() delegates to validateEvent() rather than restating its
rules, so the form cannot produce data the loader would later reject —
which would leave the page unable to boot after a save.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `token.js` と `sync.js` — 束ねる層

**Files:**
- Create: `assets/js/token.js`
- Create: `assets/js/sync.js`
- Test: `tests/sync.test.js`

**Interfaces:**
- Consumes: `createStore`、`decideSync`、`createGitHub`、`validateEvents`
- Produces:
  - `token.js`: `readToken(store)`、`writeToken(store, value)`、`clearToken(store)`、`hasToken(store)`
  - `sync.js`: `createSync({ store, fetchImpl, config })` →
    - `load()` → `{ data, source, remoteUpdatedAt }`（`source` は `decideSync` の戻り値）
    - `saveLocal(data)` — 下書きを保存し `updatedAt` を更新する
    - `adoptRemote()` — リモートを取り込み、下書きを捨てる
    - `publish(data)` → `{ commitUrl }`

`config` は `{ owner, repo, branch, path }`。ハードコードせず 1 か所にまとめる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/sync.test.js`。`store` と `fetchImpl` を両方差し替えて、通しの筋をテストする。

最低限、次を押さえること:

1. `load()` はリモートが取れれば `validateEvents` を通してから返す
2. **リモートが壊れていたら例外にし、壊れたデータを画面に出さない**
3. `load()` はリモートが取れなければローカルへ落ちる（`source === "offline"`）
4. `saveLocal()` は `updatedAt` を現在時刻に更新する
5. `publish()` は **送る前に `validateEvents` を通す**。通らなければ API を一度も叩かない
6. `publish()` は GET で sha を取り、PUT で送り、成功したら `baseUpdatedAt` を更新する
7. `publish()` が 409 のとき、ローカルの下書きを消さない
8. `adoptRemote()` はローカルを捨ててリモートを入れ、`baseUpdatedAt` を揃える

`updatedAt` の生成は現在時刻に依存するので、`now = () => Date.now()` を注入できるようにして
テストで固定すること。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/sync.test.js`
Expected: FAIL。モジュールがない。

- [ ] **Step 3: 実装する**

`assets/js/token.js` は `store.js` の薄い上に載るだけ。キーは `"gh-token"`（実体は `tp:gh-token`）。

`assets/js/sync.js` の要点:

- `publish()` の順序を守ること: **検証 → GET sha → PUT → baseUpdatedAt 更新**。
  検証を後ろに回すと壊れたデータが push される
- 409 を握りつぶさない。呼び出し側が「取り込んでから公開し直す」導線を出せるよう、
  `GitHubError` をそのまま投げ直す
- コミットメッセージは `Update itinerary from the browser` のような固定文言＋件数程度でよい

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/sync.test.js` および `node --test`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
git add assets/js/token.js assets/js/sync.js tests/sync.test.js
git commit -m "$(cat <<'EOF'
Add the sync layer over store, decide and the API client

publish() validates before it touches the network, so a malformed
draft cannot reach the repository and break the page for everyone
else. A 409 propagates rather than being swallowed, so the caller can
offer the adopt-then-republish path.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: エディタをシートに組み込む

**Files:**
- Modify: `assets/js/sheet.js`（編集モード）
- Modify: `assets/js/schedule.js`（結線）
- Modify: `schedule.html`（ツールバーに「予定を編集」「予定を追加」）
- Modify: `assets/css/controls.css`（追記のみ）
- Reference: `docs/design-reference/mock-aman.html`

**Interfaces:**
- Consumes: `eventFormHtml` / `readEventForm` / `formProblems` / `emptyEvent`、`createSheet`
- Produces: 画面の挙動のみ

`createSheet` は Phase A で「本文は呼び出し側が渡す」形に作ってある。**シェルには手を入れず、
フォームを本文として渡すだけで済むはず。** 手を入れる必要が出たら報告すること。

- [ ] **Step 1: 挙動を実装する**

| 状態 | 挙動 |
|---|---|
| 通常時にイベントをクリック | 詳細シート。フッターに「この予定を編集」 |
| 「予定を編集」ON でクリック | 直接フォーム |
| 「予定を追加」 | 空のフォーム |
| 保存 | `formProblems` が空なら反映して閉じる。空でなければ**シート内にインライン表示**し、閉じない |
| 削除 | フッターで 2 度押し |

新規保存時に `id` を採番する（既存と衝突しないこと）。保存後は `sync.saveLocal()` を呼び、
カレンダーと地図を再描画する。

- [ ] **Step 2: ブラウザで確認する**

`schedule.html` で、フォームが実データに対して期待どおり動くことを確認する。**実際にキーを押し、
クリックすること。** 少なくとも次を確かめ、結果を報告に書くこと:

- 既存イベントを開いて 1 文字変え、保存 → カレンダーに反映される
- リロードしても変更が残っている（localStorage に入っている）
- 終日への変換 → 終日行へ移る
- 日をまたぐ予定（開始日 0・終了日 2・15:00 → 11:00）→ 3 セグメントに分かれる
- 不正な入力（タイトル空、同日で終了が開始以前、緯度 999、`javascript:` URL）→
  それぞれシート内にメッセージが出て、閉じない
- 削除は 2 度押しで消え、1 度目では消えない
- Esc / ✕ / 背景クリックで閉じる。閉じたあとフォーカスが元の要素に戻る
- 390px でシートが全幅になり、横溢れがない

**コンソールに CSP 違反が出ていないことも確認すること**（Task 1 で入れた `script-src 'self'` は
`javascript:` URL を止めるので、テスト用に入れた不正 URL で違反が出るのは正しい挙動）。

- [ ] **Step 3: コミット**

---

## Task 9: 公開フローの画面

**Files:**
- Modify: `schedule.html`（公開ボタン、通知バーの器）
- Modify: `assets/js/schedule.js`
- Create: `assets/js/publish-ui.js`（トークン入力と公開の導線）
- Modify: `assets/css/controls.css`

**Interfaces:**
- Consumes: `createSync`、`token.js`
- Produces: 画面の挙動のみ

- [ ] **Step 1: 挙動を実装する**

- **トークン未設定のとき**: 「公開」ボタンを出さない。設定への導線だけ置く
- **トークン設定 UI**: 入力欄（`type="password"`）、保存、削除。**トークンを画面に表示し直さない**
- **公開ボタン**: 押すと検証 → 公開。成功したら「公開しました。反映まで 1 分ほどかかります」と
  コミットへのリンク。失敗したら `GitHubError` の文言をそのまま出す
- **409 のとき**: 「取り込んでから公開し直してください」と、取り込みボタンを添える
- **起動時に `source === "remote-is-newer"` なら**: 画面上部にバーを出し、
  「取り込む」と「自分の変更を残す」を選ばせる。**黙って上書きしない**
- **`source === "offline"` なら**: 「最新の確認ができませんでした」とだけ出し、機能は落とさない
- **未公開の変更があるとき**: 公開ボタンにその旨を示す（件数など）

- [ ] **Step 2: ブラウザで確認する**

トークンなしでも確認できる範囲を先に確かめる:

- トークン未設定で公開ボタンが出ないこと
- トークンを保存すると出ること。削除すると消えること
- 保存したトークンが画面に表示し直されないこと（DOM を調べて確認する）
- 検証を通らないデータでは公開に進まないこと

**実際の公開は、トークンを持っている人間に依頼すること。** 勝手にリポジトリへ push しない。
確認してほしい手順を報告に書く。

- [ ] **Step 3: コミット**

---

## Task 10: 通しの検証とドキュメント更新

**Files:**
- Modify: `CLAUDE.md`、`README.md`
- Modify: 設計書 §13（このフェーズで解消した項目を消す）

- [ ] **Step 1: 全ページを検証する**

4 ページ × 390px / 1440px で、コンソールエラーなし・横溢れなし・CSP 違反なし。
`node --test` が全件通ること。

- [ ] **Step 2: ドキュメントを更新する**

`CLAUDE.md` に追記する項目:

- 保存と公開の仕組み（下書きは localStorage、正はリポジトリ、公開は Contents API）
- トークンの作り方（fine-grained PAT、このリポジトリの Contents 書き込みのみ、有効期限）
- **トークンをコミットしないこと**
- 新しいモジュールの一覧と責務
- `validateEvent` と `formProblems` の関係（フォームは検査規則を書き写さない）

**書いたことをコードと突き合わせること。** Phase A ではドキュメントに 2 件の事実誤認が入り、
うち 1 件はセキュリティに関する誤った記述だった。

- [ ] **Step 3: 設計書 §13 を整理する**

このフェーズで解消した項目（CSP、`javascript:` スキーム検証）を消す。**直っていない項目を
消さないこと。** 消す項目それぞれについて、どのコミットで直ったかを報告に書く。

- [ ] **Step 4: コミット**

---

## Self-Review

**Spec coverage（B1 の範囲）**

| 設計書の項目 | 対応するタスク |
|---|---|
| §5.1 方針（下書きと正） | Task 2, 7 |
| §5.2 読み込み時の流れ | Task 4, 7, 9 |
| §5.3 公開の流れ（base64・sha・409） | Task 3, 5, 7, 9 |
| §5.4 トークンの扱い | Task 7, 9 |
| §7.2 予定エディタと入力検証 | Task 6, 8 |
| §13 CSP | Task 1 |
| §13 `javascript:` スキーム | Task 6（`formProblems`）＋ Task 1（CSP） |

B1 の対象外: 持ち物リスト（B2）、コメント（B3）、認証と暗号化（Phase C）。

**Placeholder scan**: 「適切に処理する」のような記述はなし。Task 6 の Step 4 と Task 7〜9 は
コード全文ではなく仕様とテストで示している。これはテストが仕様として十分に具体的で、
実装の書き方に幅を持たせたほうがよい箇所に限っている。

**Type consistency**: `createStore` の戻り値（`read`/`write`/`remove`/`has`）は Task 2 で定義し
Task 7 が使う。`decideSync` の 4 つの戻り値は Task 4 で定義し Task 7・9 が分岐する。
`GitHubError.status` は Task 5 で定義し Task 9 が 409 を見る。`validateEvent` は Task 6 で
公開し `formProblems` が呼ぶ。
