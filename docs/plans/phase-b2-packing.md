# Phase B2（持ち物リストとエディタ）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 持ち物リストのページとエディタを作り、旅程と同じ鍵・同じ公開フローで同期させる。

**Architecture:** `packing.json` は 2 つ目の同期対象になる。`createSync()` は Phase B4 で
`draftKey` / `baseKey` / `validate` / `commitMessage` / `codec` を注入できるようになっているので
新しい同期層は作らない ── **ただし `createPublishUI()` には同じ形の依存が手つかずで残っており
（`validateEvents` の直呼びと文言の「旅程」）、そこを先に注入可能にする。**
持ち物側のロジックは「純粋なデータ操作（`packing-data.js`）」「検証（`packing-validate.js`）」
「描画（`packing-render.js`）」「ドラッグ（`packing-drag.js`）」に割り、DOM を必要としない部分を
すべて `node --test` で押さえる。

**Tech Stack:** 素の ES modules、Pointer Events、`node --test`（依存ゼロ）。ビルドツールなし。

## Global Constraints

設計書と `CLAUDE.md` から写した規約。**全タスクの要件に暗黙に含まれる。**

- **`sync.js` のファイルごとの注入項目は必ず揃えて渡す。** 一部だけ差し替えると、その JSON が
  自分の検証を通ったうえで `store.write(draftKey, …)` が旅程の既定キーへ書き、
  **旅程の未公開の編集がその瞬間に消える**（設計書 §13）
- **`localStorage` のキー名を書き写さない。** `tp:events` / `tp:events-base` は `sync.js`、
  `tp:gh-token` は `token.js`、`tp:key` は `auth.js` だけが知っている。
  持ち物の下書きキーも `packing.js` の config 1 か所にだけ書く
- **合言葉・鍵・トークンを DOM にも例外文にも戻り値にも出さない**（設計書 §9）
- **`alert()` / `confirm()` / `prompt()` を使わない**（設計書 §9）。破壊的操作は 2 度押しで確定
- **インライン `<script>` と `on*` 属性を書かない**（CSP `script-src 'self'`）。
  `packing.html` の CSP は既存 3 ページと**同一の内容**にすること
- **色リテラルを CSS に書かない**（`tokens.css` の変数のみ）。半透明は
  `rgb(var(--ink-rgb) / 0.14)` のようにチャンネルトークンを使う
- **値を `innerHTML` に流さない。** 平文は `dom.js` の `el()`（`textContent`）、
  やむを得ず `innerHTML` なら `escapeHtml()`、URL は `safeHttpUrl()`
- **エントリポイントは `try` / `catch` / `finally` で囲み、失敗しても `initReveal()` は必ず走らせる**
  （`.reveal` は `opacity: 0` で待機しているため、飛ばすとページが真っ白になる）
- テストは `node --test`。**着手時点は 373 件 pass / 0 fail。全タスク完了時に全件 pass であること**

---

## File Structure

**新規**

| ファイル | 責務 |
|---|---|
| `assets/js/data-error.js` | `DataError`。旅程と持ち物の「データ内容の不備」の共通の基底だけを置く |
| `assets/js/packing-validate.js` | `packing.json` の形の検査。`validatePacking()` / `PackingDataError` |
| `assets/js/packing-data.js` | 採番・追加・削除・移動・進捗。DOM も store も知らない純粋関数だけ |
| `assets/js/packing-render.js` | 表の組み立て（読み取りモードと編集モード） |
| `assets/js/packing-drag.js` | Pointer Events による並べ替え。DOM を正として配列を組み直す |
| `assets/js/packing.js` | `packing.html` のエントリポイント |
| `assets/css/packing.css` | 持ち物ページ専用 |
| `tests/packing-validate.test.js` / `packing-data.test.js` / `packing-render.test.js` / `packing-drag.test.js` | 上記のテスト |
| `tests/fixtures/packing.js` | 検査とパイプラインに通す合成データ |

**変更**

| ファイル | 変更内容 |
|---|---|
| `assets/js/validate.js` | `EventDataError` を `DataError` から派生させる（既存の `instanceof` はすべて生き続ける） |
| `assets/js/load-error.js` | `classifyLoadError(error, { noun, path })` へ。判定を `DataError` に広げる |
| `assets/js/publish-ui.js` | `content`（`validate` と `noun`）を**必須で**注入。`messagesFor(noun)` を切り出す |
| `assets/js/sync.js` | `DEFAULT_CONFIG` に `noun` を足す（6 つ目）。`fetchRemote` の失敗に `status` を付ける |
| `assets/js/schedule.js` | `createPublishUI` に `content` を渡す |
| `packing.html` | 仮ページから実ページへ |
| `tests/tokens.test.js` | 色リテラル検査の対象に `packing.css` を足す |
| `tests/sync.test.js` / `publish-ui.test.js` / `load-error.test.js` | 追随 |
| `CLAUDE.md` / 設計書 §13 | 注入項目が 6 つになったこと、`publish-ui` の件を記録 |

---

## Task 1: 注入した `draftKey` が本当に効いていることを、先に押さえる

Phase B4 の繰り越し Minor。**設計書 §13 が名指しする失敗（`saveLocal` が `tp:events` を
上書きする）を守るアサーションが、現状どこにも無い。** 2 つ目の JSON を作る前に置く。
このタスクは実装を 1 行も変えない ── 今のコードが正しいことを確かめる番人を立てるだけ。

**Files:**
- Test: `tests/sync.test.js`（末尾に追記）

**Interfaces:**
- Consumes: `createSync({ store, fetchImpl, config, now })`（`assets/js/sync.js`）
- Produces: なし（テストのみ）

- [ ] **Step 1: 失敗するテストを書く**

`tests/sync.test.js` の末尾に追記する。既存のヘルパ名と衝突しないよう、
このテスト群の中で store を自作する。

```javascript
/* ── 注入した draftKey / baseKey が実際に使われているか ──────────────
 *
 * 設計書 §13 が名指しする失敗はこれ: 2 つ目の JSON 用に createSync を作った
 * つもりで、保存キーだけ既定のままだと、持ち物の saveLocal が旅程の下書き
 * （tp:events）を上書きする。旅程の未公開の編集はその瞬間に消え、
 * 気付くのは次に旅程ページを開いたときになる。
 *
 * 「投げないこと」ではなく「どのキーに書いたか」を見る。投げないだけなら
 * 既定キーへ書いていても通ってしまう。
 */
test("saveLocal は注入した draftKey に書き、既定の events キーには触らない", () => {
  const written = new Map();
  const store = {
    read: (key, fallback) => (written.has(key) ? written.get(key) : fallback),
    write: (key, value) => written.set(key, value),
    readText: () => null,
    writeText: () => {},
    remove: (key) => written.delete(key),
    has: (key) => written.has(key),
  };

  // 旅程の下書きが先にある状態を作る。これが消えないことを確かめたい
  written.set("events", { days: [{ date: "8/12", dow: "水" }], events: [], updatedAt: "2026-08-01T00:00:00.000Z" });

  const sync = createSync({
    store,
    fetchImpl: async () => {
      throw new Error("このテストは通信しない");
    },
    config: {
      path: "assets/data/packing.json",
      draftKey: "packing",
      baseKey: "packing-base",
      validate: (data) => data,
      commitMessage: () => "Update packing list",
      noun: "持ち物",
      codec: { async encode(d) { return d; }, async decode(v) { return { data: v, outerStampMismatch: false }; } },
    },
    now: () => Date.parse("2026-08-10T12:00:00.000Z"),
  });

  sync.saveLocal({ members: { a: "雄一", b: "朱汰" }, groups: [] });

  assert.ok(written.has("packing"), "注入した draftKey に書かれていません");
  assert.deepEqual(
    written.get("events").events,
    [],
    "旅程の下書き（events）が持ち物データで上書きされました"
  );
  assert.equal(written.get("events").updatedAt, "2026-08-01T00:00:00.000Z");
});

test("hasUnpublishedChanges は注入した draftKey / baseKey だけを見る", () => {
  const written = new Map();
  const store = {
    read: (key, fallback) => (written.has(key) ? written.get(key) : fallback),
    write: (key, value) => written.set(key, value),
    readText: () => null,
    writeText: () => {},
    remove: (key) => written.delete(key),
    has: (key) => written.has(key),
  };

  // 旅程側は「未公開の変更あり」の状態にしておく。持ち物側がこれを拾わないこと
  written.set("events", { updatedAt: "2026-08-09T00:00:00.000Z" });
  written.set("events-base", "2026-08-01T00:00:00.000Z");
  written.set("packing", { updatedAt: "2026-08-05T00:00:00.000Z" });
  written.set("packing-base", "2026-08-05T00:00:00.000Z");

  const sync = createSync({
    store,
    fetchImpl: async () => {
      throw new Error("このテストは通信しない");
    },
    config: {
      path: "assets/data/packing.json",
      draftKey: "packing",
      baseKey: "packing-base",
      validate: (data) => data,
      commitMessage: () => "Update packing list",
      noun: "持ち物",
      codec: { async encode(d) { return d; }, async decode(v) { return { data: v, outerStampMismatch: false }; } },
    },
  });

  assert.equal(
    sync.hasUnpublishedChanges(),
    false,
    "旅程側の未公開の変更を持ち物側が拾っています"
  );
});
```

- [ ] **Step 2: 実行して落ちることを確かめる**

Run: `node --test tests/sync.test.js`
Expected: `noun` はまだ `DEFAULT_CONFIG` に無いが、`config` はスプレッドで重ねるだけなので
**この 2 件は PASS するはず**。もし FAIL するなら注入が効いていないということで、
それ自体が設計書 §13 の失敗が実在する証拠になる。**その場合は Task 1 の中で `sync.js` を直す。**

> このタスクは「今のコードが正しいことの確認」なので、PASS で正しい。
> 落ちないテストを書いたのではなく、**落ちたら困る場所に番人を立てた**。

- [ ] **Step 3: コミット**

```bash
git add tests/sync.test.js
git commit -m "Put a guard where the design doc says the itinerary can vanish"
```

---

## Task 2: `DataError` の共通の基底と、`classifyLoadError` の一般化

持ち物の検証も「データ内容の不備」を投げる。`load-error.js` が `EventDataError` だけを
見ていると、持ち物の不備が `unknown`（「想定外のエラー」）に落ちて、直し方が伝わらない。

**Files:**
- Create: `assets/js/data-error.js`
- Modify: `assets/js/validate.js:26-31`
- Modify: `assets/js/load-error.js`
- Test: `tests/load-error.test.js`（追記）

**Interfaces:**
- Produces: `DataError`（`assets/js/data-error.js`）、
  `classifyLoadError(error, { noun = "旅程", path = "assets/data/events.json" } = {})`

- [ ] **Step 1: 失敗するテストを書く**

`tests/load-error.test.js` の末尾に追記する。

```javascript
import { DataError } from "../assets/js/data-error.js";

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
```

- [ ] **Step 2: 実行して落ちることを確かめる**

Run: `node --test tests/load-error.test.js`
Expected: FAIL（`assets/js/data-error.js` が無い）

- [ ] **Step 3: `data-error.js` を作る**

```javascript
/**
 * 「データ内容の不備」の共通の基底。
 *
 * 旅程（EventDataError）と持ち物（PackingDataError）は別のファイル・別の規則だが、
 * 利用者から見た直し方は同じ ──「再読み込みでは直らない。中身を直してから読み込み直す」。
 * load-error.js がその 1 つの分類に落とせるよう、共通の親をここに置く。
 *
 * このファイルには基底クラスしか置かない。検証規則は各 validate 側にある
 * （validate.js が旅程、packing-validate.js が持ち物）。
 */
export class DataError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataError";
  }
}
```

- [ ] **Step 4: `validate.js` の `EventDataError` を派生させる**

`assets/js/validate.js` の import に 1 行足し、クラス定義を差し替える。

```javascript
import { CAT_META } from "./categories.js";
import { DataError } from "./data-error.js";

/**
 * 旅程データ内容の不備。通信・パース失敗とは呼び出し側で区別する。
 * DataError を継承するのは、load-error.js が持ち物側の不備と同じ分類に
 * 落とせるようにするため（直し方が同じなので、文言も同じ枠でよい）。
 */
export class EventDataError extends DataError {
  constructor(message) {
    super(message);
    this.name = "EventDataError";
  }
}
```

> 既存の `instanceof EventDataError`（`schedule.js:345`、`event-editor.js:191`、
> `publish-ui.js:400`）はすべてそのまま生き続ける。派生を足しただけで狭めていない。

- [ ] **Step 5: `load-error.js` を一般化する**

import を差し替え、`classifyLoadError` に第 2 引数を足す。

```javascript
import { DataError } from "./data-error.js";
import { DecryptError } from "./crypto.js";
```

```javascript
/**
 * @param {Error} error 読み込みで投げられたもの
 * @param {{noun?: string, path?: string}} [subject] どのデータの話か。
 *   既定は旅程 ── 呼び出し側を 1 つずつ直さなくても既存の挙動が変わらないようにしてある。
 *   持ち物ページは必ず自分の noun / path を渡すこと（渡さないと「旅程データを
 *   確認してください」と案内され、利用者は存在しないファイルを探すことになる）。
 */
export function classifyLoadError(
  error,
  { noun = "旅程", path = "assets/data/events.json" } = {}
) {
  const where = `${noun}データ（${path}）`;

  if (error instanceof DataError) {
    return {
      kind: "data",
      message:
        `${where}の内容に問題があります。\n` +
        "再読み込みでは直りません。下記を直してから読み込み直してください。\n\n" +
        error.message,
    };
  }

  if (error instanceof DecryptError) {
    if (error.reason === "wrong-key") {
      return {
        kind: "wrong-key",
        message:
          `この端末の合言葉では${noun}を開けません。\n` +
          "別の合言葉で暗号化されています。index.html に戻って入れ直してください。",
      };
    }
    // corrupt と malformed をまとめるのは、利用者から見た直し方が同じだから。
    // どちらも「合言葉は合っているのに中身が読めない」で、押す手は公開し直し
    return {
      kind: "corrupt",
      message:
        `${noun}データを復号できましたが、中身が壊れています。\n` +
        `合言葉は合っている見込みです。${noun}を持っている端末から公開し直してください。\n\n` +
        error.message,
    };
  }

  if (error instanceof DataParseError) {
    return {
      kind: "parse",
      message:
        `${where}を JSON として読めませんでした。\n` +
        "ファイルの書式（末尾のカンマ、閉じ括弧、クォート）を確認してください。\n" +
        "サーバーが JSON の代わりに HTML のエラーページを返している場合も" +
        "これになります。\n\n" +
        error.message,
    };
  }

  if (error instanceof DataFetchError) {
    return {
      kind: "fetch",
      message:
        `${where}を取得できませんでした。\n` +
        "通信状況を確認してページを再読み込みするか、" +
        "手元で開いている場合は file:// ではなくローカルサーバー" +
        "（python3 -m http.server）経由でアクセスしてください。\n\n" +
        error.message,
    };
  }

  return {
    kind: "unknown",
    message:
      `${noun}の表示中に想定外のエラーが発生しました。\n` +
      "データの読み込み自体は完了している可能性があります。" +
      "詳細はブラウザのコンソールを確認してください。\n\n" +
      `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
  };
}
```

- [ ] **Step 6: テストを通す**

Run: `node --test tests/load-error.test.js`
Expected: PASS

- [ ] **Step 7: 全体を回す**

Run: `node --test`
Expected: PASS（373 + 3 件）

- [ ] **Step 8: コミット**

```bash
git add assets/js/data-error.js assets/js/validate.js assets/js/load-error.js tests/load-error.test.js
git commit -m "Let a second kind of broken data reach the same explanation"
```

---

## Task 3: `publish-ui.js` の旅程依存を注入口へ出す

**設計書 §13 に載っていない。2026-08-10 に発見した。** `createSync()` が旅程専用だった
問題と同じ形が、公開 UI 側に手つかずで残っている。

**Files:**
- Modify: `assets/js/publish-ui.js:27`（import）、`:33-87`（MESSAGES）、`:160`（引数）、`:411`（検証）
- Modify: `assets/js/schedule.js:305-319`
- Test: `tests/publish-ui.test.js`（追記）

**Interfaces:**
- Produces: `messagesFor(noun)`、
  `createPublishUI({ els, store, sync, getData, onAdopt, content })` ここで
  `content = { validate: (data) => void, noun: string }`（**両方必須**）

- [ ] **Step 1: 失敗するテストを書く**

`tests/publish-ui.test.js` の末尾に追記する（既存のヘルパ `dom()` などがあれば流用する）。

```javascript
import { messagesFor } from "../assets/js/publish-ui.js";

test("content を欠いた呼び出しは、その場で名指しして投げる", () => {
  // 片方だけ渡せるようにすると、createSync と同じ「部分的に直したときが一番危ない」
  // 状態を作ることになる。組で受け取り、欠けていたら組み立てさせない
  const base = { els: dom(), store: fakeStore(), sync: fakeSync(), getData: () => ({}), onAdopt: () => {} };

  assert.throws(() => createPublishUI({ ...base }), /content/);
  assert.throws(() => createPublishUI({ ...base, content: { noun: "持ち物" } }), /validate/);
  assert.throws(() => createPublishUI({ ...base, content: { validate: () => {} } }), /noun/);
});

test("公開前の検証は注入された validate を使う（validateEvents を呼ばない）", () => {
  let seen = null;
  const ui = createPublishUI({
    els: dom(),
    store: fakeStore(),
    sync: fakeSync(),
    // 旅程としては不正（days も events も無い）だが、持ち物としては正しい形
    getData: () => ({ members: { a: "雄一", b: "朱汰" }, groups: [] }),
    onAdopt: () => {},
    content: {
      validate: (data) => {
        seen = data;
      },
      noun: "持ち物",
    },
  });
  assert.ok(ui);
  assert.equal(seen, null, "組み立てただけで検証を走らせないこと");
});

test("messagesFor は noun を文言に通す", () => {
  const m = messagesFor("持ち物");
  assert.match(m.offline, /持ち物/);
  assert.doesNotMatch(m.offline, /旅程/);
  assert.match(m.remoteIsNewer, /持ち物/);
  assert.doesNotMatch(m.remoteIsNewer, /旅程/);
  // noun に依存しない文言は据え置き
  assert.equal(m.tokenSaved, "トークンを保存しました");
});
```

> `dom()` / `fakeStore()` / `fakeSync()` は既存の `tests/publish-ui.test.js` にある
> ヘルパを使う。無ければ同ファイルの既存テストが組み立てている形をそのまま関数に括り出す。

- [ ] **Step 2: 実行して落ちることを確かめる**

Run: `node --test tests/publish-ui.test.js`
Expected: FAIL（`messagesFor` が export されていない）

- [ ] **Step 3: `MESSAGES` を `messagesFor(noun)` に組み替える**

`assets/js/publish-ui.js` の import から `validateEvents` を落とす
（`EventDataError` は失敗の見せ分けに使うので残す）。

```javascript
import { EventDataError } from "./validate.js";
```

`MESSAGES` の定義を差し替える。**noun が入るのは 2 つだけ**で、残りは今の文言のまま。

```javascript
/**
 * 画面に出す文言。テストから参照できるよう外に出してある
 * （「この文字列が出ること」を実装の写経ではなく定数で確かめるため）。
 *
 * noun を取るのは、この UI が旅程と持ち物の両方から使われるため。
 * 「最新の旅程を確認できませんでした」を持ち物ページで出すと、
 * 利用者は開いてもいないページの話をされることになる。
 */
export function messagesFor(noun) {
  return {
    published: "公開しました。反映まで 1 分ほどかかります",
    conflictCheckSkipped:
      "リモートの更新時刻を確認できなかったため、確認せずに公開しました。" +
      "別の端末の未公開の変更を上書きした可能性があります",
    publishedNotRecorded:
      "公開はできましたが、この端末に「どこまで公開したか」を記録できませんでした",
    cannotPersist:
      "このブラウザは保存領域に書き込めないため、どの版を取り込んだかを記録できません。" +
      "取り込みを試しても同じ理由で失敗します。" +
      "プライベートブラウジングを解除する、保存領域の空きを作る、" +
      "または別の端末から公開してください",
    conflictUnverifiable:
      "公開できませんでした。リモートとの突き合わせができません" +
      "（この端末には「どこまで公開したか」の記録が残らないため）",
    offline: `最新の${noun}を確認できませんでした。手元のデータをそのまま表示しています`,
    remoteIsNewer:
      `別の端末で新しい${noun}が公開されています。` +
      "取り込むと、この端末の未公開の変更は失われます",
    keptLocal:
      "手元の変更を残しました。このまま公開すると" +
      "「リモートが更新されています」と表示されます（先に取り込みが必要です）",
    adopted: "リモートの内容を取り込みました",
    adoptFailed: "取り込めませんでした。",
    publishFailed: "公開できませんでした。",
    tokenSaved: "トークンを保存しました",
    tokenCleared: "トークンを削除しました",
    tokenEmpty: "トークンを入力してください",
    tokenHint:
      "GitHub の fine-grained personal access token（このリポジトリの Contents 書き込み権限）。" +
      "この端末のブラウザにだけ保存され、画面に表示し直すことはありません",
  };
}

/** 既存のテストと呼び出し側のための、旅程版の定数。 */
export const MESSAGES = messagesFor("旅程");
```

- [ ] **Step 4: `createPublishUI` に `content` を必須で受け取らせる**

`:160` の関数シグネチャと冒頭を差し替える。

```javascript
/**
 * @param {object} deps
 * @param {{controls:HTMLElement, panel:HTMLElement, status:HTMLElement, bar:HTMLElement}} deps.els
 * @param {object} deps.store store.js の createStore
 * @param {object} deps.sync sync.js の createSync
 * @param {() => object} deps.getData 公開するデータ全体
 * @param {(data:object) => void} deps.onAdopt 取り込んだデータで画面を描き直す
 * @param {{validate:(data:object)=>void, noun:string}} deps.content
 *   **2 つで 1 組。既定値を持たせない。** 片方だけ渡せるようにすると、
 *   sync.js の注入口と同じ「部分的に直したときが一番危ない」状態になる ──
 *   validate だけ持ち物用に差し替えて noun を旅程のままにすると、
 *   持ち物ページが「最新の旅程を確認できませんでした」と言い出す。
 *   noun だけ差し替えて validate を忘れると、持ち物データが validateEvents に
 *   落ちて公開ボタンが必ず失敗する（こちらは静かではなく必ず投げるので、
 *   sync.js のデータ消失ほど危険ではないが、直せないことに変わりはない）。
 */
export function createPublishUI({ els, store, sync, getData, onAdopt, content }) {
  if (!content) {
    throw new Error("publish-ui: content（validate と noun）が必要です");
  }
  if (typeof content.validate !== "function") {
    throw new Error("publish-ui: content.validate に検証関数が必要です");
  }
  if (typeof content.noun !== "string" || !content.noun) {
    throw new Error("publish-ui: content.noun に空でない文字列が必要です");
  }
  const { validate, noun } = content;
  const MSG = messagesFor(noun);
```

- [ ] **Step 5: 関数本体の `MESSAGES.` を `MSG.` に、`validateEvents(` を `validate(` に置き換える**

置換対象は `createPublishUI` の**本体だけ**（`:160` 以降）。
module top の `export const MESSAGES` は残す。

```bash
# 目視で確認してから行う。MESSAGES を参照しているのは createPublishUI の本体だけのはず
grep -n 'MESSAGES\.' assets/js/publish-ui.js
grep -n 'validateEvents' assets/js/publish-ui.js
```

`doPublish()` の検証（`:411` 付近）はこうなる。

```javascript
    // sync.publish() も検証するが、ここでも通す。通信を始める前に止めたいのと、
    // 「データが直っていない」と「GitHub が受け付けなかった」を別の文言で
    // 出したいため（前者は再試行しても直らない）
    try {
      validate(data);
    } catch (error) {
      console.error("publish-ui: 検証に通らないため公開しません", error);
      setStatus(
        [line("この内容では公開できません。"), line(error?.message ?? String(error), true)],
        "error"
      );
      return;
    }
```

- [ ] **Step 6: `showPublishFailure` の `EventDataError` を `DataError` に広げる**

`:400` の 1 行。持ち物の不備も複数行になるので、同じく改行を残す必要がある。

```javascript
import { DataError } from "./data-error.js";
```

```javascript
    const text = error?.message ?? String(error);
    setStatus([line(MSG.publishFailed), line(text, error instanceof DataError)], "error");
```

> `EventDataError` の import はこれで不要になる。落とすこと。

- [ ] **Step 7: `schedule.js` の呼び出しに `content` を足す**

`assets/js/schedule.js:305` の `createPublishUI({` に 1 項目足す。
`validateEvents` はまだ import されていないので import 行も足す
（`:9` の `import { EventDataError } from "./validate.js";` を拡張する）。

```javascript
import { validateEvents, EventDataError } from "./validate.js";
```

```javascript
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
    // 旅程であることをここで明示する。publish-ui は既定値を持たない
    content: { validate: validateEvents, noun: "旅程" },
    onAdopt: (data) => {
      setData(data);
      safeDraw("リモートの取り込み");
    },
  });
```

- [ ] **Step 8: テストを通す**

Run: `node --test tests/publish-ui.test.js`
Expected: PASS

> 既存のテストが `createPublishUI` を `content` 無しで呼んでいれば、そこも
> `content: { validate: validateEvents, noun: "旅程" }` を足して直す。
> **既定値を足して逃げないこと** ── このタスクの目的そのものが「組で渡させる」こと。

- [ ] **Step 9: 全体を回す**

Run: `node --test`
Expected: PASS

- [ ] **Step 10: コミット**

```bash
git add assets/js/publish-ui.js assets/js/schedule.js tests/publish-ui.test.js
git commit -m "Stop the publish UI from assuming everything is an itinerary"
```

---

## Task 4: `sync.js` に `noun` を足し、404 を「まだ無い」と区別できるようにする

持ち物の `packing.json` は**まだリポジトリに存在しない**。素の fetch は 404 を返し、
今の `fetchRemote()` は種類の分からない `Error` を投げるので、呼び出し側は
「取れなかった」と「まだ作られていない」を見分けられない。

**Files:**
- Modify: `assets/js/sync.js:47-60`（`DEFAULT_CONFIG`）、`:94-112`（`fetchRemote`）
- Test: `tests/sync.test.js`（追記）

**Interfaces:**
- Produces: `DEFAULT_CONFIG.noun`（既定 `"旅程"`）、
  `fetchRemote` が投げる `Error` に `status`（HTTP の数値。通信断・パース失敗では `undefined`）

- [ ] **Step 1: 失敗するテストを書く**

```javascript
test("404 は status を持った失敗として投げる（まだ無いファイルと通信断を区別する）", async () => {
  const store = memoryStore();
  const sync = createSync({
    store,
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    config: {
      path: "assets/data/packing.json",
      draftKey: "packing",
      baseKey: "packing-base",
      validate: (data) => data,
      commitMessage: () => "Update packing list",
      noun: "持ち物",
      codec: { async encode(d) { return d; }, async decode(v) { return { data: v, outerStampMismatch: false }; } },
    },
  });

  await assert.rejects(
    () => sync.load(),
    (error) => {
      assert.equal(error.status, 404, "status が付いていません");
      assert.match(error.message, /持ち物/, "noun が文言に効いていません");
      return true;
    }
  );
});

test("通信断には status が付かない（404 と取り違えない）", async () => {
  const store = memoryStore();
  const sync = createSync({
    store,
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
    config: { validate: (data) => data },
  });

  await assert.rejects(
    () => sync.load(),
    (error) => {
      assert.equal(error.status, undefined);
      return true;
    }
  );
});
```

> `memoryStore()` は既存の `tests/sync.test.js` のヘルパ。名前が違えば合わせる。

- [ ] **Step 2: 実行して落ちることを確かめる**

Run: `node --test tests/sync.test.js`
Expected: FAIL（`error.status` が `undefined`）

- [ ] **Step 3: `DEFAULT_CONFIG` に `noun` を足す**

`assets/js/sync.js:47`。コメントの「5 つ」を「6 つ」に直すこと。

```javascript
/**
 * 公開先と、ファイルごとに違う 6 つ。ここ以外に owner / repo / branch / path を書かないこと。
 *
 * path は 2 つの意味を兼ねている: 読み込みでは「ページからの相対 URL」、
 * Contents API では「リポジトリのルートからのパス」。今はページがリポジトリ直下に
 * 置かれているので一致している。ページをサブディレクトリへ移すなら分けること。
 *
 * draftKey / baseKey / validate / commitMessage / codec / noun は 2 つ目の JSON
 * （packing.json、comments.json）のために外へ出してある。**6 つは必ず揃えて渡すこと。**
 * 一部だけを差し替えると、その JSON が自分の検証を通ったうえで
 * store.write(draftKey, …) が旅程の既定キーへ書き、旅程の未公開の編集が
 * その瞬間に消える（設計書 §13）。
 *
 * noun だけは表示用で、取り違えてもデータは壊れない（「最新の旅程を確認できません」と
 * 持ち物ページで言うだけ）。それでも同じ組に入れてあるのは、
 * **揃えて渡す対象を「危険なものだけ」に絞ると、どれが危険かを毎回思い出す必要が
 * 生じるため** ── 全部まとめて渡す規則のほうが破りにくい。
 */
export const DEFAULT_CONFIG = {
  owner: "y-shinozaki",
  repo: "travel-plans",
  branch: "main",
  path: "assets/data/events.json",
  draftKey: "events",
  baseKey: "events-base",
  validate: validateEvents,
  commitMessage: (data) => {
    const count = data.events.length;
    return `Update itinerary from the browser (${count} event${count === 1 ? "" : "s"})`;
  },
  codec: passthroughCodec,
  noun: "旅程",
};
```

`:85` の分割代入にも足す。

```javascript
  const { draftKey, baseKey, validate, commitMessage, codec, noun } = cfg;
```

- [ ] **Step 4: `fetchRemote` に `status` と `noun` を通す**

`assets/js/sync.js:94`。

```javascript
  /**
   * リモートの JSON を読む。認証なしの素の GET なので、トークンを持たない端末でも通る。
   *
   * 失敗は握らずに投げる。オフラインとして扱うかどうかは呼び出し側が決める
   * （load() は落とす、adoptRemote() は利用者に見せる）。
   *
   * HTTP の失敗には status を付ける。**404 は「取れなかった」ではなく
   * 「まだ作られていない」**で、持ち物リストのように最初の公開までファイルが
   * 存在しないページでは、それを空のリストとして扱う必要がある
   * （私は合言葉を入力できないので、暗号化した初期ファイルを用意できない）。
   * 通信断とパース失敗には status を付けない ── 付けると
   * 「404 かどうか」の判定が undefined との比較に化けて、静かに崩れる。
   */
  async function fetchRemote() {
    let response;
    try {
      // 公開直後に古い応答を掴むと「公開したのに反映されない」に見えるため no-store
      response = await fetchImpl(cfg.path, { cache: "no-store" });
    } catch (error) {
      throw new Error(`最新の${noun}データを取得できませんでした（通信に失敗しました）`, {
        cause: error,
      });
    }
    if (!response.ok) {
      const error = new Error(
        `最新の${noun}データを取得できませんでした（HTTP ${response.status}）`
      );
      error.status = response.status;
      throw error;
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`最新の${noun}データを JSON として読めませんでした`, { cause: error });
    }
  }
```

- [ ] **Step 5: テストを通す**

Run: `node --test tests/sync.test.js`
Expected: PASS

> 既存のテストが `"最新の旅程データを…"` の文字列を見ていれば通る（既定 noun が「旅程」）。
> 落ちたら文言ではなく既定値の配線を疑うこと。

- [ ] **Step 6: 全体を回す**

Run: `node --test`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add assets/js/sync.js tests/sync.test.js
git commit -m "Tell 'not there yet' apart from 'could not reach it'"
```

---

## Task 5: `packing-validate.js` — 持ち物データの形の検査

**Files:**
- Create: `assets/js/packing-validate.js`
- Create: `tests/fixtures/packing.js`
- Test: `tests/packing-validate.test.js`

**Interfaces:**
- Consumes: `DataError`（`assets/js/data-error.js`）、`ICON_IDS`（`assets/js/icons.js`）
- Produces:
  - `PackingDataError extends DataError`
  - `validatePacking(data)` → 通れば `data` を返す。通らなければ `PackingDataError` を投げる
  - `validateItem(item, seenIds, where)` → `string[]`（不備の一覧。空なら妥当）

- [ ] **Step 1: フィクスチャを作る**

`tests/fixtures/packing.js`。**実データではなく合成データ**（設計書 §13
「Phase B4 で失った検知能力」と同じ理由で、実データはテストから読めない）。
性質を意図的に持たせる: 区分 2 つ、メモ有りと無し、チェック済みと未チェック、
2 人でチェック状態が違う項目、空の区分。

```javascript
/**
 * 持ち物リストのテスト用データ。
 *
 * 実データ（assets/data/packing.json）は暗号文なので読めない。
 * ここが持っている性質を減らすと、対応するテストが「通るが何も検査していない」
 * 状態になる ── 各テストにその番人となる下限のアサーションを置いてある。
 *
 * 意図的に含めてある性質:
 * - 区分が 2 つ以上（並べ替えと区分間移動のテストに要る）
 * - 中身が空の区分（進捗の割り算がゼロ除算にならないこと）
 * - note が空の項目と、note を持つ項目
 * - a と b でチェック状態が違う項目（進捗が別々に出ること）
 */
export const PACKING = {
  updatedAt: "2026-08-10T00:00:00.000Z",
  members: { a: "雄一", b: "朱汰" },
  groups: [
    {
      id: "g-valuables",
      name: "貴重品・書類",
      icon: "i-lock",
      items: [
        { id: "passport", name: "パスポート", note: "残存6か月以上", a: true, b: true },
        { id: "cash", name: "現金（バーツ）", note: "", a: true, b: false },
        { id: "insurance", name: "海外旅行保険の控え", note: "", a: false, b: false },
      ],
    },
    {
      id: "g-clothes",
      name: "衣類",
      icon: "i-luggage",
      items: [{ id: "swimwear", name: "水着", note: "パタヤ用", a: false, b: true }],
    },
    {
      id: "g-empty",
      name: "あとで足す",
      icon: "i-note",
      items: [],
    },
  ],
};
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/packing-validate.test.js`。

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { validatePacking, PackingDataError } from "../assets/js/packing-validate.js";
import { DataError } from "../assets/js/data-error.js";
import { PACKING } from "./fixtures/packing.js";

/** フィクスチャを壊さずに 1 か所だけ差し替えた複製を作る。 */
const clone = () => JSON.parse(JSON.stringify(PACKING));

test("フィクスチャはそのまま検査を通る", () => {
  assert.equal(validatePacking(PACKING), PACKING);
});

test("フィクスチャが検査の意味を保っている（番人）", () => {
  // 減らすと、以下のテストが「通るが何も検査していない」状態になる
  assert.ok(PACKING.groups.length >= 2, "区分が 2 つ以上必要（並べ替えのテストに要る）");
  assert.ok(
    PACKING.groups.some((g) => g.items.length === 0),
    "空の区分が必要（進捗のゼロ除算のテストに要る）"
  );
  assert.ok(
    PACKING.groups.some((g) => g.items.some((i) => i.a !== i.b)),
    "a と b でチェックが違う項目が必要（進捗が別々に出ることのテストに要る）"
  );
});

test("PackingDataError は DataError を継承している", () => {
  // load-error.js が「データ内容の不備」として分類できるための約束
  assert.ok(new PackingDataError("x") instanceof DataError);
});

test("トップレベルがオブジェクトでなければ投げる", () => {
  assert.throws(() => validatePacking(null), PackingDataError);
  assert.throws(() => validatePacking([]), PackingDataError);
});

test("members の 2 人が空でない文字列でなければ投げる", () => {
  const data = clone();
  data.members.a = "";
  assert.throws(() => validatePacking(data), /members\.a/);

  const data2 = clone();
  delete data2.members.b;
  assert.throws(() => validatePacking(data2), /members\.b/);
});

test("groups が配列でなければ投げる。空配列は通す", () => {
  const data = clone();
  data.groups = {};
  assert.throws(() => validatePacking(data), /groups/);

  const empty = { members: { a: "雄一", b: "朱汰" }, groups: [] };
  assert.equal(validatePacking(empty), empty);
});

test("区分の id が重複していれば名指しして投げる", () => {
  const data = clone();
  data.groups[1].id = data.groups[0].id;
  assert.throws(() => validatePacking(data), /g-valuables/);
});

test("項目の id は区分をまたいで一意（B3 が packing:<id> で参照するため）", () => {
  const data = clone();
  data.groups[1].items[0].id = "passport";
  assert.throws(() => validatePacking(data), /passport/);
});

test("チェック状態が真偽値でなければ投げる", () => {
  // "false" のような文字列は真になるので、進捗が黙って狂う
  const data = clone();
  data.groups[0].items[0].a = "false";
  assert.throws(() => validatePacking(data), /passport/);
  assert.throws(() => validatePacking(data), /真偽値/);
});

test("未知のアイコン id は投げる", () => {
  // icon() は未知の id で例外を投げる。描画のたびに落ちるより読み込み時に止める
  const data = clone();
  data.groups[0].icon = "i-nonexistent";
  assert.throws(() => validatePacking(data), /i-nonexistent/);
});

test("アイコンは省略できる（空文字と未設定の両方）", () => {
  const data = clone();
  data.groups[0].icon = "";
  assert.equal(validatePacking(data), data);

  const data2 = clone();
  delete data2.groups[1].icon;
  assert.equal(validatePacking(data2), data2);
});

test("不備は 1 件目で止めずにまとめて報告する", () => {
  const data = clone();
  data.groups[0].items[0].a = "false";
  data.groups[0].items[1].name = 42;
  data.groups[1].id = "";
  try {
    validatePacking(data);
    assert.fail("投げていません");
  } catch (error) {
    assert.match(error.message, /3 件の不備/);
  }
});
```

- [ ] **Step 3: 実行して落ちることを確かめる**

Run: `node --test tests/packing-validate.test.js`
Expected: FAIL（`assets/js/packing-validate.js` が無い）

- [ ] **Step 4: `packing-validate.js` を書く**

```javascript
/**
 * packing.json の形を、描画が始まる前に一度だけ検査する。
 *
 * validate.js（旅程）と同じ方針で書いてある:
 * 破ると静かに壊れる前提だけを見て、不備は 1 件目で止めずに全部集め、
 * どの項目の何が悪いのかを名指しする。
 *
 * ここで見る「静かに壊れる」の中身:
 *
 * - a / b が真偽値でないと進捗が黙って狂う（"false" は真になる）
 * - 項目の id が重複すると、チェックの切り替えが別の項目に飛ぶ
 *   （行の特定に data-id を使うため）。B3 のコメントも packing:<id> で
 *   項目を指すので、区分をまたいで一意である必要がある
 * - 未知の icon は icons.js の icon() が例外を投げる。描画のたびに落ちるより、
 *   読み込み時に「どの区分のアイコンが未知か」を名指しして止めるほうがいい
 *
 * 設計書 §4.2 に対応。
 */

import { DataError } from "./data-error.js";
import { ICON_IDS } from "./icons.js";

/** 持ち物データ内容の不備。通信・パース失敗とは呼び出し側で区別する。 */
export class PackingDataError extends DataError {
  constructor(message) {
    super(message);
    this.name = "PackingDataError";
  }
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v !== "";
const show = (v) => (typeof v === "number" ? String(v) : JSON.stringify(v));

/**
 * エラー文で項目を名指しするためのラベル。
 * validate.js の labelOf と同じ形（`${id}「${name}」`）にしてある。
 */
function labelOf(node, where) {
  const id = isNonEmptyString(node?.id) ? node.id : where;
  const name = isNonEmptyString(node?.name) ? `「${node.name}」` : "";
  return `${id}${name}`;
}

/**
 * アイコンは省略できる。指定されている場合だけスプライトにあるかを見る。
 * 未設定（undefined）と空文字の両方を「無し」として扱う ── JSON では
 * どちらの書き方もされるため。
 */
function checkIcon(icon, label, problems) {
  if (icon === undefined || icon === "") return;
  if (typeof icon !== "string") {
    problems.push(`${label}: icon が文字列ではありません（${show(icon)}）`);
    return;
  }
  if (!ICON_IDS.includes(icon)) {
    problems.push(`${label}: 未知のアイコンです（${icon}）`);
  }
}

/**
 * 項目 1 件を検査して、不備の一覧を返す（空配列なら妥当）。
 *
 * 編集フォームからも呼べるよう公開している。**項目 1 件に対する規則の
 * 置き場所はここ 1 か所だけ**にする ── フォーム側が書き写すと、写しがずれた
 * 瞬間に「保存はできるが次の読み込みで弾かれる」データを作れてしまう
 * （旅程の validateEvent / formProblems と同じ関係）。
 *
 * @param {object} item 検査する項目
 * @param {Set<string>} seenIds すでに使われている項目 id。通ったものを足していく
 * @param {string} where id を持たない項目の呼び方
 * @returns {string[]} 不備の一覧
 */
export function validateItem(item, seenIds = new Set(), where = "項目") {
  const problems = [];

  if (!isPlainObject(item)) {
    problems.push(`${where} がオブジェクトではありません`);
    return problems;
  }

  const label = labelOf(item, where);

  if (!isNonEmptyString(item.id)) {
    problems.push(`${where}: id が空でない文字列ではありません`);
  } else if (seenIds.has(item.id)) {
    // 区分をまたいで一意。行の特定にも B3 のコメントの対象キーにも使う
    problems.push(`${label}: id が重複しています`);
  } else {
    seenIds.add(item.id);
  }

  if (typeof item.name !== "string") {
    problems.push(`${label}: name が文字列ではありません（${show(item.name)}）`);
  }

  // note は省略できる
  if (item.note !== undefined && typeof item.note !== "string") {
    problems.push(`${label}: note が文字列ではありません（${show(item.note)}）`);
  }

  for (const member of ["a", "b"]) {
    if (typeof item[member] !== "boolean") {
      // "false" のような文字列は真として扱われ、進捗が黙って狂う
      problems.push(
        `${label}: ${member} のチェック状態が真偽値ではありません（${show(item[member])}）`
      );
    }
  }

  return problems;
}

function checkGroup(group, seenGroupIds, seenItemIds, where, problems) {
  if (!isPlainObject(group)) {
    problems.push(`${where} がオブジェクトではありません`);
    return;
  }

  const label = labelOf(group, where);

  if (!isNonEmptyString(group.id)) {
    problems.push(`${where}: id が空でない文字列ではありません`);
  } else if (seenGroupIds.has(group.id)) {
    problems.push(`${label}: 区分の id が重複しています`);
  } else {
    seenGroupIds.add(group.id);
  }

  if (typeof group.name !== "string") {
    problems.push(`${label}: name が文字列ではありません（${show(group.name)}）`);
  }

  checkIcon(group.icon, label, problems);

  if (!Array.isArray(group.items)) {
    problems.push(`${label}: items が配列ではありません`);
    return;
  }
  group.items.forEach((item, i) =>
    problems.push(...validateItem(item, seenItemIds, `${label} の items[${i}]`))
  );
}

/**
 * 検査に通れば data をそのまま返す。通らなければ PackingDataError を投げる。
 * 戻り値を使うことで、呼び出し側が「検査してから代入する」形に自然に書ける。
 */
export function validatePacking(data) {
  const problems = [];

  if (!isPlainObject(data)) {
    throw new PackingDataError("packing.json のトップレベルがオブジェクトではありません");
  }

  if (!isPlainObject(data.members)) {
    problems.push("members がオブジェクトではありません");
  } else {
    for (const member of ["a", "b"]) {
      if (!isNonEmptyString(data.members[member])) {
        problems.push(
          `members.${member} が空でない文字列ではありません（${show(data.members[member])}）`
        );
      }
    }
  }

  if (!Array.isArray(data.groups)) {
    problems.push("groups が配列ではありません");
  } else {
    // 区分 id と項目 id は別の名前空間。項目だけが区分をまたいで一意である必要がある
    const seenGroupIds = new Set();
    const seenItemIds = new Set();
    data.groups.forEach((group, i) =>
      checkGroup(group, seenGroupIds, seenItemIds, `groups[${i}]`, problems)
    );
  }

  if (problems.length) {
    // 全部並べると数百行になりうるので先頭だけ出し、残りは件数で示す
    const shown = problems.slice(0, 10);
    const rest = problems.length - shown.length;
    const tail = rest > 0 ? `\n…ほか ${rest} 件` : "";
    throw new PackingDataError(
      `持ち物データに ${problems.length} 件の不備があります:\n- ${shown.join("\n- ")}${tail}`
    );
  }

  return data;
}
```

- [ ] **Step 5: テストを通す**

Run: `node --test tests/packing-validate.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add assets/js/packing-validate.js tests/packing-validate.test.js tests/fixtures/packing.js
git commit -m "Check the packing list before anything tries to draw it"
```

---

## Task 6: `packing-data.js` — 採番・追加・削除・移動・進捗

DOM も store も知らない純粋関数だけ。ここが壊れたときの失われ方は静かなので
（「移動したら項目が消えた」は次に見るまで分からない）、Node のテストで押さえる。

**Files:**
- Create: `assets/js/packing-data.js`
- Test: `tests/packing-data.test.js`

**Interfaces:**
- Produces:
  - `emptyPacking()` → `{members:{a,b}, groups:[]}`
  - `nextGroupId(groups)` → `string`（`g-001` 形式）
  - `nextItemId(groups)` → `string`（`it-001` 形式）
  - `withGroup(data, group)` → 新しい `data`（同じ id が無ければ末尾に足す）
  - `withoutGroup(data, groupId)` → 新しい `data`
  - `withItem(data, groupId, item)` → 新しい `data`
  - `withoutItem(data, itemId)` → 新しい `data`
  - `moveItem(data, itemId, delta)` → 新しい `data`（`delta` は `-1` / `+1`。
    区分の端に達したら隣の区分へ送る）
  - `moveGroup(data, groupId, delta)` → 新しい `data`
  - `progressOf(data, member)` → `{done:number, total:number}`

- [ ] **Step 1: 失敗するテストを書く**

`tests/packing-data.test.js`。

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyPacking,
  nextGroupId,
  nextItemId,
  withGroup,
  withoutGroup,
  withItem,
  withoutItem,
  moveItem,
  moveGroup,
  progressOf,
} from "../assets/js/packing-data.js";
import { validatePacking } from "../assets/js/packing-validate.js";
import { PACKING } from "./fixtures/packing.js";

const clone = () => JSON.parse(JSON.stringify(PACKING));
/** 区分ごとの項目 id を並べた、比較しやすい形にする。 */
const shape = (data) => data.groups.map((g) => [g.id, g.items.map((i) => i.id)]);

test("emptyPacking は検査を通る", () => {
  const data = emptyPacking();
  assert.equal(validatePacking(data), data);
  assert.deepEqual(data.groups, []);
});

test("nextItemId は使われている id を避ける", () => {
  const data = clone();
  data.groups[0].items[0].id = "it-001";
  const id = nextItemId(data.groups);
  assert.notEqual(id, "it-001");
  assert.match(id, /^it-\d{3}$/);
});

test("nextGroupId / nextItemId は件数と最大値がずれていても衝突しない", () => {
  // 途中を削除したデータでは「件数 + 1」が既に埋まっていることがある
  const groups = [
    { id: "g-001", name: "a", items: [{ id: "it-001", name: "x", a: false, b: false }] },
    { id: "g-002", name: "b", items: [{ id: "it-002", name: "y", a: false, b: false }] },
  ];
  assert.equal(nextGroupId(groups), "g-003");
  assert.equal(nextItemId(groups), "it-003");
});

test("withItem は指定した区分の末尾に足す", () => {
  const data = clone();
  const next = withItem(data, "g-clothes", { id: "it-new", name: "サンダル", note: "", a: false, b: false });
  assert.deepEqual(
    next.groups.find((g) => g.id === "g-clothes").items.map((i) => i.id),
    ["swimwear", "it-new"]
  );
  // 元は変えない
  assert.equal(data.groups.find((g) => g.id === "g-clothes").items.length, 1);
});

test("withItem は同じ id があれば差し替える（重複を作らない）", () => {
  const data = clone();
  const next = withItem(data, "g-valuables", { id: "cash", name: "現金（円）", note: "", a: true, b: true });
  const items = next.groups.find((g) => g.id === "g-valuables").items;
  assert.equal(items.filter((i) => i.id === "cash").length, 1);
  assert.equal(items.find((i) => i.id === "cash").name, "現金（円）");
});

test("withoutItem は id で消す。どの区分にあっても効く", () => {
  const data = clone();
  const next = withoutItem(data, "swimwear");
  assert.deepEqual(shape(next), [
    ["g-valuables", ["passport", "cash", "insurance"]],
    ["g-clothes", []],
    ["g-empty", []],
  ]);
});

test("withoutGroup は中身ごと消す", () => {
  const data = clone();
  const next = withoutGroup(data, "g-valuables");
  assert.deepEqual(next.groups.map((g) => g.id), ["g-clothes", "g-empty"]);
});

test("moveItem は区分の中で入れ替える", () => {
  const data = clone();
  const next = moveItem(data, "cash", -1);
  assert.deepEqual(
    next.groups[0].items.map((i) => i.id),
    ["cash", "passport", "insurance"]
  );
});

test("moveItem は区分の端で隣の区分へ送る", () => {
  // 設計書 §7.3「↑↓ で端に達したとき隣の区分へ送る」
  const data = clone();
  const next = moveItem(data, "insurance", +1);
  assert.deepEqual(shape(next), [
    ["g-valuables", ["passport", "cash"]],
    ["g-clothes", ["insurance", "swimwear"]],
    ["g-empty", []],
  ]);
});

test("moveItem は先頭の区分の先頭より上へは動かさない", () => {
  const data = clone();
  const next = moveItem(data, "passport", -1);
  assert.deepEqual(shape(next), shape(data), "動かないこと");
});

test("moveItem は末尾の区分の末尾より下へは動かさない", () => {
  const data = clone();
  // g-empty は空なので、swimwear を下へ送ると g-empty に入る
  const once = moveItem(data, "swimwear", +1);
  assert.deepEqual(shape(once), [
    ["g-valuables", ["passport", "cash", "insurance"]],
    ["g-clothes", []],
    ["g-empty", ["swimwear"]],
  ]);
  // そこからさらに下へは行けない
  assert.deepEqual(shape(moveItem(once, "swimwear", +1)), shape(once));
});

test("moveGroup は区分の順番を入れ替える", () => {
  const data = clone();
  assert.deepEqual(
    moveGroup(data, "g-clothes", -1).groups.map((g) => g.id),
    ["g-clothes", "g-valuables", "g-empty"]
  );
  assert.deepEqual(
    moveGroup(data, "g-valuables", -1).groups.map((g) => g.id),
    ["g-valuables", "g-clothes", "g-empty"],
    "先頭より上へは動かさない"
  );
});

test("すべての操作の結果は検査を通る", () => {
  // 「保存はできたが次の読み込みで弾かれる」データを操作で作れないこと
  const data = clone();
  const results = [
    withItem(data, "g-empty", { id: nextItemId(data.groups), name: "新しい項目", note: "", a: false, b: false }),
    withGroup(data, { id: nextGroupId(data.groups), name: "新しい区分", icon: "i-note", items: [] }),
    withoutItem(data, "cash"),
    withoutGroup(data, "g-clothes"),
    moveItem(data, "insurance", +1),
    moveGroup(data, "g-empty", -1),
  ];
  for (const result of results) assert.equal(validatePacking(result), result);
});

test("progressOf は 2 人分を別々に数える", () => {
  assert.deepEqual(progressOf(PACKING, "a"), { done: 2, total: 4 });
  assert.deepEqual(progressOf(PACKING, "b"), { done: 2, total: 4 });
});

test("progressOf は項目がゼロでも落ちない", () => {
  assert.deepEqual(progressOf(emptyPacking(), "a"), { done: 0, total: 0 });
});
```

- [ ] **Step 2: 実行して落ちることを確かめる**

Run: `node --test tests/packing-data.test.js`
Expected: FAIL（`assets/js/packing-data.js` が無い）

- [ ] **Step 3: `packing-data.js` を書く**

```javascript
/**
 * 持ち物リストの純粋なデータ操作。DOM も store も知らない。
 *
 * event-editor.js の nextEventId / withEvent / withoutEvent と同じ考え方で、
 * 「壊れたときの失われ方が静かな部分」をここへ集めてある ──
 * 「移動したら項目が消えていた」は、次にそのリストを見るまで誰も気付かない。
 *
 * すべての関数は新しいオブジェクトを返し、渡されたデータを変更しない。
 * 描画の途中で配列を書き換えると、保存されるものと画面に出ているものが
 * 食い違う（schedule.js の setData と同じ理由）。
 *
 * 設計書 §4.2 / §7.3 に対応。
 */

/** 何も無い状態の持ち物リスト。members の既定は篠崎家の 2 人。 */
export function emptyPacking() {
  return {
    members: { a: "雄一", b: "朱汰" },
    groups: [],
  };
}

/**
 * 既存と衝突しない id を採番する。
 *
 * 件数から作った候補が埋まっていれば次を試す。途中を削除したデータでは
 * 件数と最大値がずれるので、「使われていないこと」を必ず確かめる
 * （event-editor.js の nextEventId と同じ理由 ── id が重複すると、
 * チェックの切り替えが別の項目に飛ぶ）。
 */
function nextId(prefix, used) {
  for (let n = used.size + 1; ; n++) {
    const id = `${prefix}-${String(n).padStart(3, "0")}`;
    if (!used.has(id)) return id;
  }
}

export function nextGroupId(groups) {
  return nextId("g", new Set(groups.map((g) => g?.id)));
}

export function nextItemId(groups) {
  // 項目 id は区分をまたいで一意（packing-validate.js の validateItem 参照）
  return nextId("it", new Set(groups.flatMap((g) => (g?.items ?? []).map((i) => i?.id))));
}

/** 区分を差し替えた（同じ id が無ければ末尾に足した）新しいデータを返す。 */
export function withGroup(data, group) {
  const index = data.groups.findIndex((g) => g?.id === group.id);
  const groups =
    index === -1
      ? [...data.groups, group]
      : data.groups.map((g, i) => (i === index ? group : g));
  return { ...data, groups };
}

/** 区分を中身ごと取り除いた新しいデータを返す。 */
export function withoutGroup(data, groupId) {
  return { ...data, groups: data.groups.filter((g) => g?.id !== groupId) };
}

/**
 * 項目を差し替えた（同じ id が無ければ指定の区分の末尾に足した）新しいデータを返す。
 *
 * 差し替えは**元あった区分の中で**行う。groupId は新規追加の行き先としてだけ使う ──
 * 既存の項目を編集するたびに区分が移動したら、並べ替えた意味が消える。
 */
export function withItem(data, groupId, item) {
  const exists = data.groups.some((g) => g.items.some((i) => i?.id === item.id));
  if (exists) {
    return {
      ...data,
      groups: data.groups.map((g) => ({
        ...g,
        items: g.items.map((i) => (i?.id === item.id ? item : i)),
      })),
    };
  }
  return {
    ...data,
    groups: data.groups.map((g) =>
      g.id === groupId ? { ...g, items: [...g.items, item] } : g
    ),
  };
}

/** 項目を取り除いた新しいデータを返す（どの区分にあっても効く）。 */
export function withoutItem(data, itemId) {
  return {
    ...data,
    groups: data.groups.map((g) => ({
      ...g,
      items: g.items.filter((i) => i?.id !== itemId),
    })),
  };
}

/** 項目の居場所を探す。見つからなければ null。 */
function locate(groups, itemId) {
  for (let gi = 0; gi < groups.length; gi++) {
    const ii = groups[gi].items.findIndex((i) => i?.id === itemId);
    if (ii !== -1) return { gi, ii };
  }
  return null;
}

/**
 * 項目を 1 つ上（delta = -1）または下（delta = +1）へ動かす。
 *
 * 区分の端に達したら隣の区分へ送る（設計書 §7.3）。全体の先頭より上、
 * 全体の末尾より下へは動かさない ── そこで「動かない」ことは、
 * ボタンを押しても何も起きないという形で利用者に伝わる。
 *
 * 隣の区分が空でも送れる。空の区分を素通りさせると、押した回数と
 * 動いた距離が合わなくなり、どこへ行ったのかが分からなくなる。
 */
export function moveItem(data, itemId, delta) {
  const groups = data.groups;
  const at = locate(groups, itemId);
  if (at === null || (delta !== -1 && delta !== 1)) return data;

  const { gi, ii } = at;
  const item = groups[gi].items[ii];
  const target = ii + delta;

  // 同じ区分の中で収まる場合
  if (target >= 0 && target < groups[gi].items.length) {
    const items = [...groups[gi].items];
    items.splice(ii, 1);
    items.splice(target, 0, item);
    return { ...data, groups: groups.map((g, i) => (i === gi ? { ...g, items } : g)) };
  }

  // 端に達した。隣の区分へ送る
  const gTarget = gi + delta;
  if (gTarget < 0 || gTarget >= groups.length) return data; // 全体の端。動かさない

  return {
    ...data,
    groups: groups.map((g, i) => {
      if (i === gi) return { ...g, items: g.items.filter((x) => x?.id !== itemId) };
      if (i !== gTarget) return g;
      // 上へ送るなら受け入れ先の末尾、下へ送るなら先頭。
      // 「押した向きに 1 つ進む」が見た目と一致する置き方
      return { ...g, items: delta === -1 ? [...g.items, item] : [item, ...g.items] };
    }),
  };
}

/** 区分を 1 つ上（delta = -1）または下（delta = +1）へ動かす。 */
export function moveGroup(data, groupId, delta) {
  const index = data.groups.findIndex((g) => g?.id === groupId);
  if (index === -1 || (delta !== -1 && delta !== 1)) return data;

  const target = index + delta;
  if (target < 0 || target >= data.groups.length) return data;

  const groups = [...data.groups];
  const [group] = groups.splice(index, 1);
  groups.splice(target, 0, group);
  return { ...data, groups };
}

/**
 * 1 人分の進捗。
 *
 * total を分母に使う側（進捗バー）がゼロ除算にならないよう、件数をそのまま返して
 * 割り算は呼び出し側に任せる。項目が 1 つも無い状態は実際に起こる
 * （まだ何も足していないリスト）。
 */
export function progressOf(data, member) {
  let done = 0;
  let total = 0;
  for (const group of data.groups) {
    for (const item of group.items) {
      total++;
      if (item[member] === true) done++;
    }
  }
  return { done, total };
}
```

- [ ] **Step 4: テストを通す**

Run: `node --test tests/packing-data.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add assets/js/packing-data.js tests/packing-data.test.js
git commit -m "Move things around the packing list without losing them"
```

---

## Task 7: `packing-drag.js` — DOM を正として配列を組み直す

設計書 §7.3 の「並び順は DOM を正として、指を離した時点で `data-id` を読んで配列を
再構築する」。**組み直しの部分は純粋関数として切り出し、そこをテストする。**

**Files:**
- Create: `assets/js/packing-drag.js`
- Test: `tests/packing-drag.test.js`

**Interfaces:**
- Consumes: `moveItem`（`packing-data.js`）は使わない。順序は DOM から丸ごと受け取る
- Produces:
  - `rebuildFromOrder(data, order)` → 新しい `data`。
    `order` は `[{ id: "g-xxx", itemIds: ["it-1", ...] }, ...]`
  - `attachDrag({ root, getData, commit })` → `{ detach() }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/packing-drag.test.js`。

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { rebuildFromOrder } from "../assets/js/packing-drag.js";
import { validatePacking } from "../assets/js/packing-validate.js";
import { PACKING } from "./fixtures/packing.js";

const clone = () => JSON.parse(JSON.stringify(PACKING));
const shape = (data) => data.groups.map((g) => [g.id, g.items.map((i) => i.id)]);
/** 現在の並びをそのまま order の形にする。 */
const orderOf = (data) =>
  data.groups.map((g) => ({ id: g.id, itemIds: g.items.map((i) => i.id) }));

test("同じ並びを渡せば内容は変わらない", () => {
  const data = clone();
  const next = rebuildFromOrder(data, orderOf(data));
  assert.deepEqual(shape(next), shape(data));
});

test("区分をまたいで項目を移した並びを反映する", () => {
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["cash", "passport"] },
    { id: "g-clothes", itemIds: ["insurance", "swimwear"] },
    { id: "g-empty", itemIds: [] },
  ]);
  assert.deepEqual(shape(next), [
    ["g-valuables", ["cash", "passport"]],
    ["g-clothes", ["insurance", "swimwear"]],
    ["g-empty", []],
  ]);
  // 中身は運ばれている（id だけ並べ替えて実体を捨てていないこと）
  const moved = next.groups[1].items.find((i) => i.id === "insurance");
  assert.equal(moved.name, "海外旅行保険の控え");
});

test("区分そのものの並べ替えも反映する", () => {
  const data = clone();
  const reversed = orderOf(data).reverse();
  assert.deepEqual(
    rebuildFromOrder(data, reversed).groups.map((g) => g.id),
    ["g-empty", "g-clothes", "g-valuables"]
  );
});

test("order に無い項目は落とさず、元の区分の末尾に残す", () => {
  // DOM の読み取りが取りこぼしたときに、項目が黙って消えないための保険。
  // ドラッグ中に別のタブで保存された、描画が途中で失敗した、などで起こりうる
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["passport"] },
    { id: "g-clothes", itemIds: ["swimwear"] },
    { id: "g-empty", itemIds: [] },
  ]);
  const all = next.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.ok(all.includes("cash"), "order に無い cash が消えました");
  assert.ok(all.includes("insurance"), "order に無い insurance が消えました");
  assert.equal(all.length, 4, "件数が変わっています");
});

test("order に無い区分も落とさない", () => {
  const data = clone();
  const next = rebuildFromOrder(data, [{ id: "g-clothes", itemIds: ["swimwear"] }]);
  assert.equal(next.groups.length, 3);
  assert.equal(next.groups[0].id, "g-clothes", "order にある区分が先頭に来ること");
});

test("知らない id が混ざっていても落ちない", () => {
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-valuables", itemIds: ["passport", "it-ghost", "cash", "insurance"] },
    { id: "g-ghost", itemIds: ["it-ghost"] },
    { id: "g-clothes", itemIds: ["swimwear"] },
    { id: "g-empty", itemIds: [] },
  ]);
  assert.equal(validatePacking(next), next);
  const all = next.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.ok(!all.includes("it-ghost"));
});

test("組み直した結果は必ず検査を通る", () => {
  const data = clone();
  const next = rebuildFromOrder(data, [
    { id: "g-empty", itemIds: ["passport", "swimwear"] },
    { id: "g-valuables", itemIds: [] },
    { id: "g-clothes", itemIds: ["cash", "insurance"] },
  ]);
  assert.equal(validatePacking(next), next);
});
```

- [ ] **Step 2: 実行して落ちることを確かめる**

Run: `node --test tests/packing-drag.test.js`
Expected: FAIL（`assets/js/packing-drag.js` が無い）

- [ ] **Step 3: `packing-drag.js` を書く**

```javascript
/**
 * Pointer Events による並べ替え。
 *
 * HTML5 Drag & Drop は使わない ── タッチ端末で動かないため（設計書 §7.3）。
 * ドラッグが使えない環境のために ↑↓ ボタンを常に併設してあるので、
 * ここが動かなくても並べ替えはできる。
 *
 * 並び順は **DOM を正**とする。指を離した時点で data-id を読んで配列を
 * 組み直す（ドラッグ中に再描画しないので動きが途切れない）。
 * 組み直しの部分（rebuildFromOrder）は DOM を知らない純粋関数にしてあり、
 * node --test で押さえてある ── 「移動したら項目が消えた」は、
 * 次にそのリストを見るまで誰も気付かない類の壊れ方だから。
 */

/**
 * DOM から読んだ並び順でデータを組み直す。
 *
 * **order に載っていない区分・項目は落とさない。** DOM の読み取りが
 * 取りこぼしても（描画が途中で失敗した、別のタブで保存された、など）
 * 項目が黙って消えないようにするため。order にあるものを先に、
 * 無いものを元の順のまま後ろに置く。
 *
 * 知らない id は無視する。実体を持たない id を並べても項目は生まれない。
 *
 * @param {object} data 現在の持ち物データ
 * @param {{id:string, itemIds:string[]}[]} order DOM から読んだ並び
 * @returns {object} 新しいデータ
 */
export function rebuildFromOrder(data, order) {
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  // 項目は区分をまたいで一意なので、1 つの表で引ける
  const itemById = new Map(
    data.groups.flatMap((g) => g.items.map((item) => [item.id, item]))
  );

  const placedGroups = new Set();
  const placedItems = new Set();

  const groups = [];
  for (const entry of order) {
    const group = groupById.get(entry?.id);
    if (!group || placedGroups.has(group.id)) continue;
    placedGroups.add(group.id);

    const items = [];
    for (const itemId of entry.itemIds ?? []) {
      const item = itemById.get(itemId);
      if (!item || placedItems.has(itemId)) continue;
      placedItems.add(itemId);
      items.push(item);
    }
    groups.push({ ...group, items });
  }

  // order に載らなかった区分を、元の順のまま後ろへ。中身は空にしておき、
  // 取りこぼした項目は下のループで元の区分へ戻す
  for (const group of data.groups) {
    if (placedGroups.has(group.id)) continue;
    placedGroups.add(group.id);
    groups.push({ ...group, items: [] });
  }

  // order に載らなかった項目を、元あった区分の末尾へ戻す
  const indexOfGroup = new Map(groups.map((g, i) => [g.id, i]));
  for (const original of data.groups) {
    for (const item of original.items) {
      if (placedItems.has(item.id)) continue;
      placedItems.add(item.id);
      const at = indexOfGroup.get(original.id);
      if (at === undefined) continue;
      groups[at] = { ...groups[at], items: [...groups[at].items, item] };
    }
  }

  return { ...data, groups };
}

/** ドラッグ中の行に付ける印。CSS 側（packing.css）が見る。 */
const DRAGGING_CLASS = "is-dragging";

/**
 * 現在の DOM から並び順を読む。
 * 区分は [data-group-id]、項目は [data-item-id] を持つ想定
 * （packing-render.js が付ける）。
 */
function readOrder(root) {
  return [...root.querySelectorAll("[data-group-id]")].map((groupEl) => ({
    id: groupEl.dataset.groupId,
    itemIds: [...groupEl.querySelectorAll("[data-item-id]")].map((el) => el.dataset.itemId),
  }));
}

/**
 * ドラッグを配線する。
 *
 * @param {object} deps
 * @param {HTMLElement} deps.root 表全体。ここから querySelectorAll で並びを読む
 * @param {() => object} deps.getData 現在の持ち物データ
 * @param {(data:object) => void} deps.commit 組み直した結果を保存して描き直す
 * @returns {{detach: () => void}}
 */
export function attachDrag({ root, getData, commit }) {
  let dragging = null; // { row, placeholderAfter }

  function onPointerDown(event) {
    const handle = event.target.closest?.("[data-drag-handle]");
    if (!handle || event.button > 0) return;
    const row = handle.closest("[data-item-id]");
    if (!row) return;

    event.preventDefault();
    dragging = { row };
    row.classList.add(DRAGGING_CLASS);

    // capture は補助。失敗する環境があるので握って続ける
    // （pointermove / pointerup は window に付けてあるので、capture が
    // 効かなくてもポインタがハンドルから外れた時点で止まることはない）
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* 効かない環境では window のリスナだけで動かす */
    }
  }

  /**
   * ポインタの真下にある行の前後どちらへ差し込むかを決めて、その場で DOM を動かす。
   * データはまだ触らない ── 指を離すまで再描画しないので、動きが途切れない。
   */
  function onPointerMove(event) {
    if (!dragging) return;
    event.preventDefault();

    const under = document.elementFromPoint(event.clientX, event.clientY);
    const target = under?.closest?.("[data-item-id]");
    if (target && target !== dragging.row) {
      const box = target.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      target.parentNode.insertBefore(dragging.row, after ? target.nextSibling : target);
      return;
    }

    // 空の区分の上に来たとき。行が 1 つも無いので elementFromPoint では拾えない
    const emptyGroup = under?.closest?.("[data-item-list]");
    if (emptyGroup && !emptyGroup.querySelector("[data-item-id]")) {
      emptyGroup.appendChild(dragging.row);
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging.row.classList.remove(DRAGGING_CLASS);
    dragging = null;
    // ここで初めてデータを組み直す。DOM が正
    commit(rebuildFromOrder(getData(), readOrder(root)));
  }

  root.addEventListener("pointerdown", onPointerDown);
  // ハンドルではなく window に付ける。setPointerCapture が失敗する環境で、
  // ポインタがハンドルから外れた瞬間にドラッグが止まるため（設計書 §7.3）
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  return {
    detach() {
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
```

- [ ] **Step 4: テストを通す**

Run: `node --test tests/packing-drag.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add assets/js/packing-drag.js tests/packing-drag.test.js
git commit -m "Let the DOM decide the order, then put the data back together"
```

---

## Task 8: `packing.css` と `packing.html` の実ページ化

**Files:**
- Create: `assets/css/packing.css`
- Modify: `assets/css/calendar.css:5-23` → `assets/css/controls.css`（`.toolbar` の引っ越し）
- Modify: `packing.html`
- Modify: `tests/tokens.test.js:199`
- Test: `tests/csp.test.js`（変更不要だが 3 ページを見ていることを確認する）

**確認済みの実在するクラス**（2026-08-10 に `grep` で確認。**思い込みで書かないこと**）:

| 使うもの | 実際の場所 | 注意 |
|---|---|---|
| `.toolbar` / `.toolbar__group` / `.toolbar__group--end` | **`calendar.css:5-23`** | schedule 専用ファイルにある。**引っ越しが要る**（Step 0） |
| `.pub` / `.pubpanel` / `.pubstat` / `.syncbar` | `controls.css:517` 以降 | そのまま使える |
| `.tbtn` / `.rowbtn` / `.inp` / `.inp--note` / `.inp--group` | `controls.css` | そのまま使える |
| チェックボックス | **`.check` + `.check__box`**（`controls.css:141`） | `.chk` は**存在しない**。マークアップの形は Task 9 参照 |
| `.pubctl` | **存在しない** | `pub-controls` は `<span class="toolbar__group">` で包む（`schedule.html:70`） |

**Interfaces:**
- Produces: `packing.html` の DOM 契約 ──
  `#nav` / `#pk-table` / `#pk-progress` / `#pk-edit-toggle` / `#pk-add-group` /
  `#pub-controls` / `#pub-panel` / `#pub-status` / `#syncbar`

- [ ] **Step 0: `.toolbar` を `calendar.css` から `controls.css` へ移す**

`.toolbar` は今 `calendar.css` にある。CLAUDE.md はこのファイルを
**「`schedule.html` 専用」**と宣言しているので、持ち物ページから使うなら移すこと。
`packing.html` から `calendar.css` を読み込んで済ませない ── カレンダーと地図の
数百行が持ち物ページにも配信されるうえ、宣言と実態が食い違う。

`assets/css/calendar.css:5-23` の 3 ブロック（`.toolbar` / `.toolbar__group` /
`.toolbar__group--end`）を `controls.css` へ移す。**`.toolbar select`（`:25-39`）は
残すこと** ── セレクトを置いているのは schedule だけで、移すと
「呼び出し側のない CSS」（設計書 §13）を 1 つ増やすことになる。

移した先のコメント:

```css
/* ══════════════════════════════════════════════════════════
   TOOLBAR — 旅程と持ち物で共有する横並びの操作列
   （calendar.css から移した。Phase B2 で 2 ページ目が使い始めたため。
   .toolbar select は schedule だけが使うので calendar.css に残してある）
   ══════════════════════════════════════════════════════════ */
```

Run: `node --test tests/tokens.test.js && python3 -m http.server 8000`
Expected: テストは PASS。`schedule.html` を開いてツールバーが**移動前と同じ見た目**であること
（色リテラル検査は移動先でも同じく効く）。

- [ ] **Step 1: 先に `tokens.test.js` を直して落ちることを確かめる**

`tests/tokens.test.js:199` の配列に `packing.css` を足す。
**これを先にやる** ── 後回しにすると、新しい CSS だけ無検査のまま完成してしまう
（設計書 §13「小さいもの」が名指ししている穴）。

```javascript
  const files = ["base.css", "controls.css", "calendar.css", "packing.css"];
```

Run: `node --test tests/tokens.test.js`
Expected: FAIL（`assets/css/packing.css` が無い → `readFileSync` が投げる）

- [ ] **Step 2: `packing.css` を書く**

色リテラルを書かないこと。半透明は `rgb(var(--ink-rgb) / …)`。

```css
/* 持ち物リスト（packing.html）専用。
   色・余白・角丸・モーションの値は tokens.css の変数だけを使う。
   行アクションと入力欄は controls.css の .rowbtn / .inp を流用する
   （持ち物リスト待ちで置いてあったもの: .rowbtn--del / .rowbtn--confirm /
   .inp--note / .inp--group）。 */

/* ── 進捗 ── */
.pkprog {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s3);
  margin-top: var(--s3);
}
.pkprog__one {
  flex: 1 1 200px;
  min-width: 0;
}
.pkprog__name {
  font-size: 11px;
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: var(--ink-2);
}
.pkprog__count {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 300;
  color: var(--ink);
}
.pkprog__bar {
  height: 2px;
  margin-top: 6px;
  background: var(--line-soft);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.pkprog__fill {
  height: 100%;
  background: var(--ink);
  transition: width var(--t-mid) var(--e-out);
}

/* ── 表 ── */
.pkgroup {
  margin-top: var(--s5);
  border-top: 1px solid var(--line-soft);
}
.pkgroup__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--s2) 0;
}
.pkgroup__ico {
  display: grid;
  place-items: center;
  color: var(--ink-2);
}
.pkgroup__name {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 300;
  color: var(--ink);
}
.pkgroup__count {
  margin-left: auto;
  font-size: 11px;
  letter-spacing: 1.4px;
  color: var(--ink-2);
}
.pkgroup__acts {
  display: flex;
  gap: 2px;
  margin-left: 10px;
}

.pkitems {
  list-style: none;
  margin: 0;
  padding: 0;
}
.pkitem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px solid rgb(var(--ink-rgb) / 0.06);
}
.pkitem__body {
  flex: 1 1 auto;
  min-width: 0;
}
.pkitem__name {
  font-size: 14px;
  color: var(--ink);
}
.pkitem__note {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ink-2);
}
.pkitem__checks {
  display: flex;
  gap: 14px;
  flex: 0 0 auto;
}
.pkitem__acts {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
}

/* ドラッグハンドル。touch-action: none を付けないと、
   スクロールのジェスチャが pointermove を奪う（設計書 §7.3）。 */
.pkdrag {
  flex: 0 0 auto;
  touch-action: none;
  cursor: grab;
}
.pkdrag:active {
  cursor: grabbing;
}
.pkitem.is-dragging {
  opacity: 0.5;
  background: var(--sand);
}

/* 編集モードの出し分けは CSS で隠すのではなく、packing-render.js が
   要素を組み立てないことで行う（.pkedit-only のようなクラスを作らないこと）。
   隠すだけだと、読み取りモードでもボタンがタブ移動で到達でき、
   支援技術からも見える ── 押せてしまえば編集モードでないのに保存が走る。 */

@media (max-width: 760px) {
  .pkitem {
    flex-wrap: wrap;
  }
  .pkitem__checks {
    width: 100%;
    justify-content: flex-end;
  }
}
```

> `--s2` 〜 `--s5`、`--r-pill`、`--t-mid`、`--e-out`、`--line-soft`、`--sand`、
> `--ink` / `--ink-2` / `--ink-rgb`、`--serif` が `tokens.css` に実在することを
> 書く前に `grep` で確かめること。無い変数を使うと、テストは通るのに無色になる。

- [ ] **Step 3: `packing.html` を書く**

**CSP は既存 3 ページと同一の内容にすること**（`schedule.html` からそのまま写す）。
インライン `<script>` と `on*` 属性を書かないこと。

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
    <link rel="stylesheet" href="assets/css/packing.css" />
  </head>
  <body data-page="packing">
    <nav class="nav" id="nav"></nav>
    <!-- role / aria-label は schedule.html と揃える。同じ役割の領域なので -->
    <div class="syncbar" id="syncbar" role="region" aria-label="同期の状態" hidden></div>

    <main class="wrap sec">
      <p class="eyebrow">Packing</p>
      <h1 class="display" style="font-size: clamp(32px, 4.2vw, 50px)">持ち物リスト</h1>

      <div class="pkprog reveal" id="pk-progress"></div>

      <div class="toolbar reveal">
        <!-- ラベルとアイコンは JS が入れる。HTML に <use href="#i-..."> を
             直書きすると injectSprite() より前にパースされ、WebKit が参照を
             解決し直さないことがある（schedule.html と同じ理由）。
             データが読めていない状態で押されないよう disabled で置く。 -->
        <div class="toolbar__group toolbar__group--end">
          <button class="tbtn" id="pk-edit-toggle" type="button" aria-pressed="false" disabled></button>
          <button class="tbtn" id="pk-add-group" type="button" disabled></button>
          <!-- 公開ボタンとトークン設定の置き場。トークンが無いときに
               公開ボタンを置かないので、中身は publish-ui.js が入れる。 -->
          <span class="toolbar__group" id="pub-controls"></span>
        </div>
      </div>

      <!-- トークン設定（開閉）と、公開・取り込みの結果。
           結果は押した直後に出るが、割り込みたいほどではないので polite。 -->
      <div class="pub">
        <div class="pubpanel" id="pub-panel" hidden></div>
        <div class="pubstat" id="pub-status" role="status" aria-live="polite" hidden></div>
      </div>

      <div id="pk-table"></div>
    </main>

    <script type="module" src="assets/js/packing.js"></script>
  </body>
</html>
```

> **`.reveal` を付けた要素は `opacity: 0` で待機する。** `packing.js` の
> `main()` が `initReveal()` を `finally` で必ず走らせること（Task 10）──
> 飛ばすと進捗もツールバーも見えないまま残る。
>
> `pk-table` に `.reveal` を付けないのは、読み込み失敗時に `showLoadError` が
> ここへエラーを書くため。透明なままだと失敗の説明ごと見えなくなる。

- [ ] **Step 4: テストを通す**

Run: `node --test tests/tokens.test.js tests/csp.test.js`
Expected: PASS

- [ ] **Step 5: ブラウザで開いて崩れていないことを見る**

```bash
python3 -m http.server 8000
# http://localhost:8000/packing.html
```

この時点では表は空（`packing.js` がまだ無いのでツールバーも無反応）。
**確かめるのはレイアウトが崩れていないことと、コンソールにエラーが出ないこと**
（`stub-page.js` を外したので `#nav` が空のままなのが正しい）。

- [ ] **Step 6: コミット**

```bash
git add assets/css/packing.css packing.html tests/tokens.test.js
git commit -m "Give the packing page a real shell, and put it under the color guard"
```

---

## Task 9: `packing-render.js` — 表と進捗の描画

**Files:**
- Modify: `assets/js/icons.js`（`i-grip` を足す）
- Create: `assets/js/packing-render.js`
- Test: `tests/packing-render.test.js`

**Interfaces:**
- Consumes: `el`（`dom.js`）、`icon`（`icons.js`）、`progressOf`（`packing-data.js`）。
  **`escapeHtml` は使わない** ── このファイルが `innerHTML` に入れるのは
  `icon()` の戻り値と `CHECK_MARK` だけで、どちらも定数。値は必ず `el()` を通す
- Produces:
  - `renderProgress({ mount, data })`
  - `renderTable({ mount, data, editing, handlers })` ここで
    `handlers = { onToggle(itemId, member, checked), onMoveItem(itemId, delta),
    onMoveGroup(groupId, delta), onDeleteItem(itemId), onDeleteGroup(groupId),
    onRenameItem(itemId, patch), onRenameGroup(groupId, patch), onAddItem(groupId) }`

- [ ] **Step 0: スプライトに `i-grip`（ドラッグハンドル）を足す**

既存の記号にドラッグハンドルに当たるものが無い。`i-note`（メモ帳）で代用すると、
支援技術にも目にも「メモ」と伝わる別のものになる。

`assets/js/icons.js` の `SPRITE` に足す（`i-check` の隣）。

```html
  <symbol id="i-grip" viewBox="0 0 24 24">
    <path d="M8 7h8M8 12h8M8 17h8"/>
  </symbol>
```

`ICON_IDS` にも足す。**両方やること** ── `tests/icons.test.js` の
「ICON_IDS とスプライトの中身が一致する」が `deepEqual` で突き合わせている。

```javascript
  // Phase B の編集 UI（ツールバーとシートのフッター）
  "i-edit", "i-plus", "i-check",
  // Phase B2 の並べ替えハンドル
  "i-grip",
```

> `fill` / `stroke` を `symbol` の中に書かないこと（`icons.test.js` が検査している）。
> 色は `.ico` の `stroke: currentColor` から継承させる。
> `viewBox="0 0 24 24"` も必須。

Run: `node --test tests/icons.test.js`
Expected: PASS

- [ ] **Step 1: 失敗するテストを書く**

`tests/packing-render.test.js`。**`renderers.test.js` と同じ最小 DOM スタブ**を使う
（`document.createElement` だけを備え、`innerHTML` と `textContent` のどちらに
入ったかを記録する）。既存の実装をそのまま持ってくること。

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { renderProgress, renderTable } from "../assets/js/packing-render.js";
import { PACKING } from "./fixtures/packing.js";

/* renderers.test.js と同じ最小スタブ。document.createElement だけを備え、
   innerHTML に入った文字列と textContent に入った文字列を別々に記録する。
   狙いは「イベント由来の文字列が innerHTML に流れていないこと」の検査。 */
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
      setAttribute() {},
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      replaceChildren(...kids) {
        this.children = kids;
      },
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    return node;
  };
  globalThis.document = { createElement: make };
  return { htmlSink, textSink, make };
}

test("進捗は 2 人分をそれぞれ出す", () => {
  const { make, textSink } = stubDocument();
  const mount = make("div");
  renderProgress({ mount, data: PACKING });
  const text = textSink.join("\n");
  assert.match(text, /雄一/);
  assert.match(text, /朱汰/);
  assert.match(text, /2\s*\/\s*4/);
});

test("項目が 0 件でも落ちない（ゼロ除算）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const empty = { members: { a: "雄一", b: "朱汰" }, groups: [] };
  assert.doesNotThrow(() => renderProgress({ mount, data: empty }));
});

test("項目名とメモは textContent に入り、innerHTML には出ない", () => {
  const { make, htmlSink, textSink } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [
      {
        id: "g-1",
        name: "<script>alert(1)</script>",
        icon: "i-note",
        items: [
          { id: "it-1", name: "<img onerror=x>", note: "\"><b>", a: false, b: false },
        ],
      },
    ],
  };
  renderTable({ mount, data, editing: false, handlers: {} });

  const html = htmlSink.join("\n");
  const text = textSink.join("\n");
  assert.ok(text.includes("<img onerror=x>"), "項目名が textContent に入っていません");
  assert.ok(text.includes('"><b>'), "メモが textContent に入っていません");
  assert.ok(!html.includes("onerror"), "項目名が innerHTML に流れています");
  assert.ok(!html.includes("alert(1)"), "区分名が innerHTML に流れています");
});

test("行は data-item-id、区分は data-group-id を持つ（ドラッグが読む）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: true, handlers: {} });

  const ids = [];
  const walk = (node) => {
    if (node.dataset?.itemId) ids.push(node.dataset.itemId);
    for (const child of node.children ?? []) walk(child);
  };
  walk(mount);
  assert.deepEqual(ids, ["passport", "cash", "insurance", "swimwear"]);
});

test("読み取りモードでは編集用のボタンを組み立てない", () => {
  const { make } = stubDocument();
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });

  const editing = make("div");
  renderTable({ mount: editing, data: PACKING, editing: true, handlers: {} });

  const count = (node) => {
    let n = node.tagName === "BUTTON" ? 1 : 0;
    for (const child of node.children ?? []) n += count(child);
    return n;
  };
  assert.ok(
    count(editing) > count(readOnly),
    "編集モードでボタンが増えていません（editing が効いていない）"
  );
});
```

- [ ] **Step 2: 実行して落ちることを確かめる**

Run: `node --test tests/packing-render.test.js`
Expected: FAIL（`assets/js/packing-render.js` が無い）

- [ ] **Step 3: `packing-render.js` を書く**

**イベント由来の文字列を `innerHTML` に流さないこと。**
アイコンだけが `innerHTML`（`icon()` が返すのは定数から作った文字列）。

```javascript
/**
 * 持ち物リストの描画。
 *
 * 通常時は読むだけの静かな見た目、「リストを編集」で編集モードへ（設計書 §7.3）。
 * 2 つのモードを別の関数にせず editing で分けるのは、行の構造を 1 か所に
 * 保つため ── 2 つに割ると、data-item-id の付け忘れのような
 * 「片方だけ動かない」がドラッグの配線まで見つからない。
 *
 * 値は必ず el()（textContent）で入れる。innerHTML に入るのは icon() が返す
 * 定数だけ。ブラウザで入力した文字列を、リポジトリ書き込み権限を持つトークンを
 * 抱えたページ自身が描画するため（CLAUDE.md の規約）。
 */

import { el } from "./dom.js";
import { icon } from "./icons.js";
import { progressOf } from "./packing-data.js";

/** 文字は textContent、アイコンだけ定数の innerHTML。値は絶対に混ぜない。 */
function iconButton(cls, iconId, label) {
  const button = el("button", cls);
  button.type = "button";
  button.innerHTML = icon(iconId, "ico--sm");
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

/** 1 度目で身構え、2 度目で実行するボタン。confirm() は使わない。 */
function armedIconButton({ cls, armedCls, iconId, label, armedLabel, onConfirm }) {
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
 * 2 人分の進捗。達成数と細いバー（設計書 §7.3）。
 * 割り算はここで行い、total が 0 のときは 0% にする ── 項目が 1 つも無い状態は
 * 実際に起こる（まだ何も足していないリスト）。
 */
export function renderProgress({ mount, data }) {
  const nodes = [];
  for (const member of ["a", "b"]) {
    const { done, total } = progressOf(data, member);
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    const one = el("div", "pkprog__one");
    one.appendChild(el("p", "pkprog__name", data.members[member]));
    one.appendChild(el("p", "pkprog__count", `${done} / ${total}`));

    const bar = el("div", "pkprog__bar");
    const fill = el("div", "pkprog__fill");
    fill.style.width = `${percent}%`;
    bar.appendChild(fill);
    one.appendChild(bar);

    one.setAttribute("role", "group");
    one.setAttribute("aria-label", `${data.members[member]} の進捗 ${done} / ${total}`);
    nodes.push(one);
  }
  mount.replaceChildren(...nodes);
}

/**
 * チェックの印。**icon("i-check") を使わないこと。**
 *
 * controls.css の `.check__box svg path` が stroke-dashoffset を遷移させて
 * チェックを描くアニメーションを持っている。icon() が返すのは
 * `<svg><use href="#i-check"/></svg>` で、path はシャドウツリーの中に入るため
 * このセレクタが届かない ── チェックを入れても印が出ないボックスになる。
 * event-form.js:126 と aman-mock.html:2487 も同じ生の SVG を書いている。
 */
const CHECK_MARK =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="m4.5 12.6 5.2 5.2L19.5 6.6"/></svg>';

/**
 * チェックボックス 1 つ。**編集モードでなくても押せる**
 * （チェックを付けるのは「編集」ではなく、このページの主目的そのもの）。
 *
 * マークアップは controls.css の `.check` の契約に合わせる:
 *   label.switch > span.check > (input[type=checkbox] + span.check__box > svg) , span
 * input と .check__box が**隣接兄弟**であること（`.check input:checked + .check__box`）。
 * 間に何か挟むと、チェックしても色が変わらない。
 */
function checkCell(item, member, memberName, onToggle) {
  const label = el("label", "switch");

  const wrap = el("span", "check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = item[member] === true;
  input.setAttribute("aria-label", `${memberName}: ${item.name}`);
  input.addEventListener("change", () => onToggle?.(item.id, member, input.checked));

  const box = el("span", "check__box");
  box.innerHTML = CHECK_MARK; // 定数のみ。値は混ぜない

  wrap.appendChild(input);
  wrap.appendChild(box);

  label.appendChild(wrap);
  label.appendChild(el("span", null, memberName));
  return label;
}

/** 名前とメモ。編集モードでは入力欄になる（設計書 §7.3「行がそのまま入力欄になる」）。 */
function itemBody(item, editing, onRename) {
  const body = el("div", "pkitem__body");
  if (!editing) {
    body.appendChild(el("p", "pkitem__name", item.name));
    if (item.note) body.appendChild(el("p", "pkitem__note", item.note));
    return body;
  }

  const name = document.createElement("input");
  name.className = "inp";
  name.type = "text";
  name.value = item.name;
  name.setAttribute("aria-label", "項目名");
  name.addEventListener("change", () => onRename?.(item.id, { name: name.value }));

  const note = document.createElement("input");
  note.className = "inp inp--note";
  note.type = "text";
  note.value = item.note ?? "";
  note.placeholder = "メモ";
  note.setAttribute("aria-label", "メモ");
  note.addEventListener("change", () => onRename?.(item.id, { note: note.value }));

  body.appendChild(name);
  body.appendChild(note);
  return body;
}

function itemRow(item, data, editing, handlers) {
  const row = el("li", "pkitem");
  row.dataset.itemId = item.id;

  if (editing) {
    // ドラッグハンドル。touch-action: none は packing.css 側で付ける。
    // aria-hidden にするのは、ドラッグを使えない人のために ↑↓ ボタンを
    // 併設してあるため ── 両方が読み上げられると同じ操作が 2 回出てくる
    const handle = el("span", "pkdrag");
    handle.innerHTML = icon("i-grip", "ico--sm");
    handle.dataset.dragHandle = "1";
    handle.setAttribute("aria-hidden", "true");
    row.appendChild(handle);
  }

  row.appendChild(itemBody(item, editing, handlers.onRenameItem));

  const checks = el("div", "pkitem__checks");
  for (const member of ["a", "b"]) {
    checks.appendChild(checkCell(item, member, data.members[member], handlers.onToggle));
  }
  row.appendChild(checks);

  if (editing) {
    const acts = el("div", "pkitem__acts");
    // ドラッグが使えない環境のために ↑↓ を常に併設する（設計書 §7.3）
    const up = iconButton("rowbtn", "i-arrow-right", "1 つ上へ");
    up.style.transform = "rotate(-90deg)";
    up.addEventListener("click", () => handlers.onMoveItem?.(item.id, -1));
    const down = iconButton("rowbtn", "i-arrow-right", "1 つ下へ");
    down.style.transform = "rotate(90deg)";
    down.addEventListener("click", () => handlers.onMoveItem?.(item.id, +1));
    acts.appendChild(up);
    acts.appendChild(down);
    acts.appendChild(
      armedIconButton({
        cls: "rowbtn rowbtn--del",
        armedCls: "rowbtn rowbtn--confirm",
        iconId: "i-x",
        label: `${item.name} を削除`,
        armedLabel: "もう一度で削除",
        onConfirm: () => handlers.onDeleteItem?.(item.id),
      })
    );
    row.appendChild(acts);
  }

  return row;
}

function groupBlock(group, data, editing, handlers) {
  const block = el("section", "pkgroup");
  block.dataset.groupId = group.id;

  const head = el("div", "pkgroup__head");
  if (group.icon) {
    const mark = el("span", "pkgroup__ico");
    mark.innerHTML = icon(group.icon, "ico--sm");
    mark.setAttribute("aria-hidden", "true");
    head.appendChild(mark);
  }

  if (editing) {
    const name = document.createElement("input");
    name.className = "inp inp--group";
    name.type = "text";
    name.value = group.name;
    name.setAttribute("aria-label", "区分名");
    name.addEventListener("change", () =>
      handlers.onRenameGroup?.(group.id, { name: name.value })
    );
    head.appendChild(name);
  } else {
    head.appendChild(el("h2", "pkgroup__name", group.name));
  }

  const done = group.items.filter((i) => i.a && i.b).length;
  head.appendChild(el("p", "pkgroup__count", `${done} / ${group.items.length}`));

  if (editing) {
    const acts = el("div", "pkgroup__acts");
    const up = iconButton("rowbtn", "i-arrow-right", "この区分を 1 つ上へ");
    up.style.transform = "rotate(-90deg)";
    up.addEventListener("click", () => handlers.onMoveGroup?.(group.id, -1));
    const down = iconButton("rowbtn", "i-arrow-right", "この区分を 1 つ下へ");
    down.style.transform = "rotate(90deg)";
    down.addEventListener("click", () => handlers.onMoveGroup?.(group.id, +1));
    acts.appendChild(up);
    acts.appendChild(down);
    acts.appendChild(
      armedIconButton({
        cls: "rowbtn rowbtn--del",
        armedCls: "rowbtn rowbtn--confirm",
        iconId: "i-x",
        // 中身の数を出す（設計書 §7.3）。何件消えるのかを見ずに押させない
        label: `${group.name} を削除`,
        armedLabel: `もう一度で ${group.items.length} 件ごと削除`,
        onConfirm: () => handlers.onDeleteGroup?.(group.id),
      })
    );
    head.appendChild(acts);
  }

  block.appendChild(head);

  const list = el("ul", "pkitems");
  // 空の区分にもドラッグで項目を落とせるようにするための目印（packing-drag.js が読む）
  list.dataset.itemList = "1";
  for (const item of group.items) {
    list.appendChild(itemRow(item, data, editing, handlers));
  }
  block.appendChild(list);

  if (editing) {
    const add = el("button", "tbtn");
    add.type = "button";
    add.innerHTML = icon("i-plus", "ico--sm");
    add.appendChild(el("span", null, "項目を追加"));
    add.addEventListener("click", () => handlers.onAddItem?.(group.id));
    block.appendChild(add);
  }

  return block;
}

/**
 * 表全体。
 *
 * @param {object} args
 * @param {HTMLElement} args.mount 差し替え先
 * @param {object} args.data 持ち物データ
 * @param {boolean} args.editing 編集モードか
 * @param {object} args.handlers 行の操作。すべて省略可（テストが空で呼ぶ）
 */
export function renderTable({ mount, data, editing, handlers = {} }) {
  if (data.groups.length === 0) {
    const empty = el(
      "p",
      "body",
      editing
        ? "まだ何もありません。下の「区分を追加」から始めてください。"
        : "まだ何もありません。「リストを編集」から追加できます。"
    );
    mount.replaceChildren(empty);
    return;
  }
  mount.replaceChildren(
    ...data.groups.map((group) => groupBlock(group, data, editing, handlers))
  );
}
```

- [ ] **Step 4: テストを通す**

Run: `node --test tests/packing-render.test.js`
Expected: PASS

> **ブラウザで実際にチェックを付けて、印が出ることを確かめること。**
> `.check__box svg path` のアニメーションは `node --test` では確かめられない
> （最小スタブは CSS を持たない）。印が出なければ `<use>` を使っている疑い ──
> `CHECK_MARK` のコメントを読むこと。

- [ ] **Step 5: コミット**

```bash
git add assets/js/packing-render.js tests/packing-render.test.js
git commit -m "Draw the list quietly, and only grow controls when editing"
```

---

## Task 10: `packing.js` — エントリポイントと配線

**Files:**
- Create: `assets/js/packing.js`

**Interfaces:**
- Consumes: これまでの全モジュール
- Produces: なし（エントリポイント）

- [ ] **Step 1: `packing.js` を書く**

起動順は `schedule.js` と揃える: **鍵の確認 → `publish-ui` の組み立て → `load()`**。
理由は同じ（リモートが壊れていても公開ボタンとトークン設定を画面に出す。設計書 §13）。

```javascript
/**
 * packing.html のエントリポイント。
 *
 * 起動順は schedule.js と同じ「鍵の確認 → publish-ui の組み立て → load()」。
 * publish-ui を load() の後ろに置くと、リモートが壊れた端末では公開ボタンも
 * トークン設定も DOM に現れず、ブラウザから直す手段がゼロになる（設計書 §13）。
 *
 * packing.json は**最初の公開までリポジトリに存在しない**。404 を「まだ無い」として
 * 空のリストで始める ── 暗号化した初期ファイルを外から用意する手段が無いため
 * （合言葉を持つ人が画面で項目を足して公開した瞬間に、最初のファイルができる）。
 */

import { injectSprite, icon } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { el, escapeHtml } from "./dom.js";
import { createStore } from "./store.js";
import { createSync, DEFAULT_CONFIG } from "./sync.js";
import { createPublishUI } from "./publish-ui.js";
import { classifyLoadError, DataFetchError, DataParseError } from "./load-error.js";
import { hasKey, loadCodec, clearKey } from "./auth.js";
import { DecryptError } from "./crypto.js";
import { DataError } from "./data-error.js";
import { validatePacking } from "./packing-validate.js";
import {
  emptyPacking,
  nextGroupId,
  nextItemId,
  withGroup,
  withoutGroup,
  withItem,
  withoutItem,
  moveItem,
  moveGroup,
} from "./packing-data.js";
import { renderProgress, renderTable } from "./packing-render.js";
import { attachDrag } from "./packing-drag.js";

/** どのデータの話かを 1 か所に持つ。sync / publish-ui / load-error の 3 つが読む。 */
const SUBJECT = { noun: "持ち物リスト", path: "assets/data/packing.json" };

const state = {
  data: null,
  editing: false,
};

const els = {
  table: document.getElementById("pk-table"),
  progress: document.getElementById("pk-progress"),
  editToggle: document.getElementById("pk-edit-toggle"),
  addGroup: document.getElementById("pk-add-group"),
  pubControls: document.getElementById("pub-controls"),
  pubPanel: document.getElementById("pub-panel"),
  pubStatus: document.getElementById("pub-status"),
  syncbar: document.getElementById("syncbar"),
};

let publishUI = null;
let sync = null;
let drag = null;

/**
 * 描き直す。ドラッグは表を作り直すたびに配線し直す ──
 * 前の表の要素はもう文書にいないので、リスナも一緒に捨てる。
 */
function draw() {
  renderProgress({ mount: els.progress, data: state.data });
  renderTable({
    mount: els.table,
    data: state.data,
    editing: state.editing,
    handlers,
  });

  drag?.detach();
  drag = state.editing
    ? attachDrag({ root: els.table, getData: () => state.data, commit: apply })
    : null;
}

/**
 * 再描画の失敗を画面に出す（schedule.js の safeDraw と同じ役割）。
 * ここで落ちると、表が半分だけ描かれた状態で止まり、利用者には何も伝わらない。
 */
function safeDraw(context) {
  try {
    draw();
    setNotice(null);
  } catch (error) {
    console.error(`packing: 再描画に失敗しました（${context}）`, error);
    setNotice(
      `表示の更新に失敗しました（${context}）。` +
        "直前の表示のまま止まっています。原因はブラウザのコンソールを確認してください。"
    );
  }
}

let noticeEl = null;
function setNotice(message) {
  if (!message && !noticeEl) return;
  if (!noticeEl) {
    noticeEl = document.createElement("p");
    noticeEl.className = "ferror";
    noticeEl.setAttribute("role", "alert");
    els.table.parentNode.insertBefore(noticeEl, els.table);
  }
  noticeEl.textContent = message ?? "";
  noticeEl.hidden = !message;
}

/**
 * 変更を保存して描き直す。
 *
 * 順序が意味を持つ: 検査 → 下書きへ書く → 反映。saveLocal が投げたら
 * state も画面も動かない ── 保存できていないのに画面だけ新しい、という
 * 食い違いを作らない（schedule.js の commit と同じ）。
 *
 * 配列全体を validatePacking に通すのは、1 件ずつの検査では id の重複を
 * 検出できないため（event-editor.js の applyChange と同じ理由）。
 */
function apply(next) {
  try {
    validatePacking(next);
    state.data = sync.saveLocal(next);
  } catch (error) {
    console.error("packing: 保存できませんでした", error);
    setNotice(
      error instanceof DataError
        ? `この内容では保存できません。${error.message}`
        : `保存に失敗しました。${error?.message ?? String(error)}`
    );
    return;
  }
  publishUI?.refreshDirty();
  safeDraw("持ち物リストの保存");
}

const handlers = {
  onToggle(itemId, member, checked) {
    const item = state.data.groups.flatMap((g) => g.items).find((i) => i.id === itemId);
    if (!item) return;
    apply(withItem(state.data, null, { ...item, [member]: checked }));
  },
  onRenameItem(itemId, patch) {
    const item = state.data.groups.flatMap((g) => g.items).find((i) => i.id === itemId);
    if (!item) return;
    apply(withItem(state.data, null, { ...item, ...patch }));
  },
  onRenameGroup(groupId, patch) {
    const group = state.data.groups.find((g) => g.id === groupId);
    if (!group) return;
    apply(withGroup(state.data, { ...group, ...patch }));
  },
  onAddItem(groupId) {
    apply(
      withItem(state.data, groupId, {
        id: nextItemId(state.data.groups),
        name: "新しい項目",
        note: "",
        a: false,
        b: false,
      })
    );
  },
  onDeleteItem: (itemId) => apply(withoutItem(state.data, itemId)),
  onDeleteGroup: (groupId) => apply(withoutGroup(state.data, groupId)),
  onMoveItem: (itemId, delta) => apply(moveItem(state.data, itemId, delta)),
  onMoveGroup: (groupId, delta) => apply(moveGroup(state.data, groupId, delta)),
};

function buildToolbar() {
  const label = el("span", null, "リストを編集");
  els.editToggle.innerHTML = icon("i-edit", "ico--sm");
  els.editToggle.appendChild(label);
  els.editToggle.addEventListener("click", () => {
    state.editing = !state.editing;
    els.editToggle.setAttribute("aria-pressed", String(state.editing));
    label.textContent = state.editing ? "編集を終える" : "リストを編集";
    els.addGroup.hidden = !state.editing;
    safeDraw("編集モードの切り替え");
  });

  els.addGroup.innerHTML = icon("i-plus", "ico--sm");
  els.addGroup.appendChild(el("span", null, "区分を追加"));
  els.addGroup.addEventListener("click", () =>
    apply(
      withGroup(state.data, {
        id: nextGroupId(state.data.groups),
        name: "新しい区分",
        icon: "i-note",
        items: [],
      })
    )
  );

  els.editToggle.disabled = false;
  els.addGroup.disabled = false;
  els.addGroup.hidden = true;
}

function showLoadError(error) {
  const { message } = classifyLoadError(error, SUBJECT);
  els.table.innerHTML = `<p class="ferror ferror--block">${escapeHtml(message)}</p>`;
}

async function main() {
  injectSprite();
  renderNav(document.getElementById("nav"), "packing");

  const store = createStore();

  // 鍵が無ければ復号できない。合言葉を入れてもらうため入口へ戻す。
  // hasKey() ではなく loadCodec() の結果で判断する理由は schedule.js のコメント参照
  // （形は正しいが base64 として壊れた鍵は hasKey を通り、loadCodec で null になる）。
  const codec = hasKey(store) ? await loadCodec(store) : null;
  if (codec === null) {
    clearKey(store);
    location.replace("index.html");
    return;
  }

  // **6 つを揃えて渡す。** 一部だけだと旅程の下書き（tp:events）が
  // 持ち物データで上書きされる（設計書 §13、sync.js の DEFAULT_CONFIG のコメント）
  sync = createSync({
    store,
    config: {
      ...DEFAULT_CONFIG,
      path: SUBJECT.path,
      draftKey: "packing",
      baseKey: "packing-base",
      validate: validatePacking,
      commitMessage: (data) => {
        const count = data.groups.reduce((n, g) => n + g.items.length, 0);
        return `Update packing list from the browser (${count} item${count === 1 ? "" : "s"})`;
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
    content: { validate: validatePacking, noun: SUBJECT.noun },
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
      state.data = emptyPacking();
      buildToolbar();
      publishUI.start("use-local");
      draw();
      return;
    }

    // リモートが壊れていても、手元に正しい下書きがあれば公開で直せる
    // （schedule.js の同じ catch と同じ理由。設計書 §6.5）
    const draft = sync.readDraft();
    if (draft) {
      state.data = draft;
      publishUI.refreshDirty();
    }

    if (error instanceof DataError) throw error;
    if (error instanceof DecryptError) throw error;
    if (error?.cause instanceof SyntaxError) throw new DataParseError(error.message, error.cause);
    throw new DataFetchError(error?.message ?? String(error));
  }

  state.data = loaded.data;
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

- [ ] **Step 2: 全体を回す**

Run: `node --test`
Expected: PASS（全件）

- [ ] **Step 3: ブラウザで通しで確かめる**

```bash
python3 -m http.server 8000
```

`node --test` では確かめられない部分。**1 つずつ実際に触ること。**

1. `http://localhost:8000/` で合言葉を入れる
2. 「持ち物」へ移動 → **空のリストが出る**（404 が「まだ無い」として扱われている）
3. 「リストを編集」→「区分を追加」→「項目を追加」→ 名前とメモを入力
4. チェックを付けて、**進捗のバーと数字が動く**
5. ↑↓ で項目を動かす。**区分の端で隣の区分へ送られる**
6. ドラッグハンドルで並べ替える。**スマートフォンの実機で試すこと**
   （`touch-action: none` が効いていないと、並べ替えの代わりにページがスクロールする）
7. 削除ボタンを 1 度押して身構え、2 度目で消える
8. **タブを閉じて開き直す** → 下書きが残っている
9. 旅程ページを開く → **旅程が無事**（`tp:events` が壊れていない）

> **9 を飛ばさないこと。** 設計書 §13 が名指しする失敗は、ここでしか目視できない。

- [ ] **Step 4: コミット**

```bash
git add assets/js/packing.js
git commit -m "Wire the packing page up, starting from nothing"
```

---

## Task 11: ドキュメントを実態に合わせる

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/spec/travel-plans-redesign.md`（§2.3 の表、§13）
- Modify: `docs/handoff/2026-08-10.md`

- [ ] **Step 1: `CLAUDE.md` を直す**

- ファイル構成に `packing.css` / `packing-*.js` / `packing.js` を足す
- 「Phase B2 の仮ページ」の記述を消す
- **「`config` は … 5 つを持つ」を 6 つに直す**（`noun` を足したため）。
  該当箇所は「保存と公開（Phase B1 / B4）」の `createSync()` の段落
- **`localStorage` のキーの表に `tp:packing` / `tp:packing-base` を足す**
  （知っているのは `packing.js` の config だけ、と書く）
- 「新しいカテゴリを追加」の隣に、**色リテラル検査の対象ファイルに `packing.css` を
  足したこと**を記録する
- テストの節に `packing-validate` / `packing-data` / `packing-render` / `packing-drag` を足す

- [ ] **Step 2: 設計書 §2.3 の表を直す**

```
| B2 | 持ち物リストページとエディタ | B4 | **完了**（2026-08-10） |
```

- [ ] **Step 3: 設計書 §13 に 2 件記録する**

**解消したものを消すのではなく、経緯を残す**（この節の既存の書き方に合わせる）。

1. **`createPublishUI()` も旅程専用だった（B2 で解消）** ──
   `validateEvents` の直呼びと文言の「旅程」。`createSync()` の項目と同じ形だが、
   壊れ方は違う（**静かに消えるのではなく必ず投げる**）。`content`（`validate` と `noun`）を
   組で必須にした。**片方だけ渡せるようにしなかった理由**を書くこと
2. **`sync.js` の注入項目が 6 つになった** ── `noun` を足した。
   表示用なので取り違えてもデータは壊れないが、**「揃えて渡す対象を危険なものだけに
   絞ると、どれが危険かを毎回思い出す必要が生じる」**ため同じ組に入れた

**「小さいもの」から 1 件落とす:**
「CSS の色リテラル検査は対象ファイルをハードコードしている（`packing.css` を足すと
無検査になる）」→ 足したので解消。ただし**ハードコードしている事実は残る**ので、
「次に CSS を足すときも同じ穴が開く」と書き換えること（消さない）。

- [ ] **Step 4: `docs/handoff/2026-08-10.md` を更新する**

第 1 群を完了に。第 2 群（B3）を次に。**第 0 群（人の作業）が終わっているかは
勝手に決めないこと** ── トークンの失効も開通確認も、私からは確かめようがない。

- [ ] **Step 5: 全体を回してコミット**

```bash
node --test
git add CLAUDE.md docs/
git commit -m "Record what B2 changed, including the trap that was not in the design doc"
```

---

## Self-Review

**1. Spec coverage** — 設計書 §4.2 / §7.3 の各項目に対応するタスク:

| 仕様 | タスク |
|---|---|
| §4.2 `packing.json` の構造（`members` / `groups` / `items`） | Task 5（検証）、Task 6（操作） |
| §7.3 二人分の進捗（達成数と細いバー） | Task 9（`renderProgress`）、Task 6（`progressOf`） |
| §7.3 「区分 → 項目」の 2 階層 | Task 9（`groupBlock` / `itemRow`） |
| §7.3 通常時は読むだけの静かな見た目 | Task 9（`editing` で分岐）、Task 8（`.pkedit-only`） |
| §7.3 項目の追加 | Task 10（`onAddItem`） |
| §7.3 区分の追加（表の最下部） | Task 10（`buildToolbar` の「区分を追加」） |
| §7.3 名称・メモの編集（行がそのまま入力欄） | Task 9（`itemBody` の editing 分岐） |
| §7.3 並べ替え（ドラッグ／↑↓） | Task 7（ドラッグ）、Task 6 + 9（↑↓） |
| §7.3 区分をまたぐ移動 | Task 6（`moveItem` の端の処理）、Task 7（`rebuildFromOrder`） |
| §7.3 削除（✕ 2 度押し、区分は件数を出す） | Task 9（`armedIconButton`） |
| §7.3 Pointer Events / `touch-action: none` / `window` に登録 / capture は try/catch | Task 7、Task 8（CSS） |
| §7.3 DOM を正として指を離した時点で再構築 | Task 7（`rebuildFromOrder`） |
| §5 保存と公開（同じ鍵・同じフロー） | Task 4、Task 10（6 つを揃えて渡す） |
| §6 暗号化（同じソルト・同じ鍵） | Task 10（`loadCodec` の codec をそのまま渡す） |

**「項目は区分をまたいで移動できる」（§4.2 末尾）** は Task 6 の `moveItem` と
Task 7 の `rebuildFromOrder` の両方でカバーしている。

**2. 意図的に落としたもの**

- **`imagePos` の許可リスト検証**（設計書 §13）── B2 は画像位置の入力欄を作らないので
  到達しない。§13 に残したまま、B3 以降へ繰り越す
- **`packing.json` の初期データ投入** ── 私は合言葉を入力できないので、
  空から始めて本人が画面で足す（Task 10 で 404 を空として扱う設計にした）

**3. 実行順の依存**

Task 1 → 2 → 3 → 4 は順に依存する（`DataError` が 3 の `showPublishFailure` に、
`noun` が 4 で入る）。5 → 6 → 7 は 2 に依存し、互いには依存しない。
8 は独立。9 は 6 に依存。10 は全部に依存。11 は最後。

**4. 着手前に読むもの**

- `docs/handoff/2026-08-10.md`（B2 の地雷をまとめてある）
- 設計書 §13 の「Phase B1 からの繰り越し（保存と公開）」の先頭項目
  （`createSync()` が旅程専用だった話。**B2 が最初に踏むはずだった罠**で、
  B4 で解消済みだが、危険の性質は `publish-ui` 側にそのまま残っていた）
