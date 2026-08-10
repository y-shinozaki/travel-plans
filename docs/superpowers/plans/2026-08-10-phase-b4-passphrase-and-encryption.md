# Phase B4（合言葉と暗号化）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同期する JSON を合言葉で暗号化し、鍵を持つ端末だけが旅程を読めるようにする。

**Architecture:** 暗号は `crypto.js` の codec（`encode` / `decode`）に閉じ込め、`createSync()` へ注入する。リモートのファイルは **封筒 JSON**（`updatedAt` を暗号文の外に複製し、`kdf` / `iv` / `ct` を持つ）になるため、B1 の競合検出（`assertRemoteNotAhead`）は無改造で動き続ける。導出鍵は `auth.js` が `localStorage` にキャッシュし、PBKDF2 600,000 回は端末ごとに 1 回だけ走る。

**Tech Stack:** 素の ES modules、WebCrypto（PBKDF2-HMAC-SHA256 / AES-GCM-256）、`node --test`（依存ゼロ）。ビルドツールなし。

## Global Constraints

これは設計書から写した値と規約で、**全タスクの要件に暗黙に含まれる**。

- 反復回数 `600000`、ソルト `16` バイト、IV `12` バイト、AES-GCM `256` bit（設計書 §6.2）
- **IV は暗号化のたびに引き直す。** 鍵と組で使い回すと AES-GCM は平文が漏れる（§6.2）
- **ソルトは 3 つの JSON で共有する。** codec はファイルの `kdf` からではなく、キャッシュした鍵素材から組み立てる（§6.3）
- **鍵と合言葉は DOM にも例外文にも戻り値の文字列にも出さない**（§9）。`localStorage` へは `store.readText` / `writeText` で書く（`store.read` は `JSON.parse` を通すので、壊れた値の先頭が `SyntaxError` の文言として `console.warn` に出る）
- **`localStorage` のキー名を書き写さない。** `tp:key` は `auth.js` だけが知る（`tp:events` / `tp:events-base` は `sync.js`、`tp:gh-token` は `token.js`）
- **`alert()` / `confirm()` / `prompt()` を使わない**（§9）。破壊的操作は 2 度押しで確定
- **インライン `<script>` と `on*` 属性を書かない**（CSP `script-src 'self'`）
- **色リテラルを CSS に書かない**（`tokens.css` の変数のみ。`tests/tokens.test.js` が検査）
- イベント由来の文字列を `innerHTML` にそのまま流さない。平文は `el()`、やむを得ず `innerHTML` なら `escapeHtml()`、URL は `safeHttpUrl()`
- 各ページのエントリポイントは `try` / `catch` / `finally` で囲み、**失敗しても `initReveal()` は必ず走らせる**（`.reveal` は `opacity: 0` で待機しているため）
- テストは `node --test`。全タスク完了時に **全件 pass** であること（着手時点は 301 件）

---

## File Structure

**新規**

| ファイル | 責務 |
|---|---|
| `assets/js/crypto.js` | 暗号だけを知る。`store` も DOM も fetch も知らない |
| `assets/js/auth.js` | 鍵の保存場所（`tp:key`）と一生。`crypto.js` の上に載る薄い層 |
| `assets/js/load-error.js` | 読み込み失敗の分類と文言。純粋関数だけ（`schedule.js` から切り出す） |
| `tests/crypto.test.js` / `tests/auth.test.js` / `tests/load-error.test.js` | 上記のテスト |

**変更**

| ファイル | 変更内容 |
|---|---|
| `assets/js/base64.js` | バイト列の入口（`toBase64Bytes` / `fromBase64Bytes`）を足し、既存の 2 関数をその上に載せ替える |
| `assets/js/sync.js` | `config` に `draftKey` / `baseKey` / `validate` / `commitMessage` / `codec` の 5 つを**同時に**足す。復号と暗号化を挟む |
| `assets/js/schedule.js` | 起動順を「鍵の確認 → `publish-ui` → `load()`」へ。失敗分類を `load-error.js` へ委譲 |
| `assets/js/menu.js` | 合言葉フォーム。カードを 2 枚に |
| `assets/js/nav.js` | `archive` のエントリを削除 |
| `index.html` | 合言葉の入力欄を置く |
| `archive.html` | **削除** |
| `assets/js/stub-page.js` | `packing.html` 専用に |
| `tests/base64.test.js` / `sync.test.js` / `csp.test.js` / `renderers.test.js` | 追随 |
| `CLAUDE.md` / `README.md` | 手編集手順の廃止、ファイル構成、鍵の扱い |

---

## Task 1: base64 にバイト列の入口を足す

**Files:**
- Modify: `assets/js/base64.js`
- Test: `tests/base64.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `toBase64Bytes(bytes: Uint8Array) → string`、`fromBase64Bytes(b64: string) → Uint8Array`。既存の `toBase64Utf8(text: string) → string` と `fromBase64Utf8(b64: string) → string` は挙動そのままで内部だけ載せ替える

ソルト・IV・暗号文は生バイト列なので、UTF-8 文字列専用の今の 2 関数では扱えない。バイト列を 1 文字ずつ足す処理（`String.fromCharCode(...bytes)` は長い入力で `RangeError` になるので避けてある）を 2 か所に増やさないため、下の層を切り出して既存関数をその上に載せる。§13 のテストの穴「`fromBase64Utf8()` の型ガードにテストがない」もここで塞ぐ。

- [ ] **Step 1: 失敗するテストを書く**

`tests/base64.test.js` の末尾に追記する。

```js
import { toBase64Bytes, fromBase64Bytes } from "../assets/js/base64.js";

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
```

`fromBase64Utf8` が既存の import に無ければ、ファイル冒頭の import に足す。

- [ ] **Step 2: 失敗することを確認する**

Run: `node --test tests/base64.test.js`
Expected: FAIL。`toBase64Bytes is not a function`（未定義）。最後の 1 件だけは既存実装で pass する可能性がある

- [ ] **Step 3: 実装する**

`assets/js/base64.js` を丸ごと下記に置き換える。

```js
/**
 * UTF-8 文字列 ⇄ base64、およびバイト列 ⇄ base64。
 *
 * GitHub Contents API はファイル内容を base64 で受け取る。
 * btoa() は Latin-1 しか扱えず、日本語を渡すと InvalidCharacterError になる。
 * 旅程データは日本語だらけなので、専用に切ってある。
 *
 * バイト列を 1 文字ずつ足すのは、String.fromCharCode(...bytes) だと
 * 引数が多すぎて長い入力で RangeError になるため。
 *
 * バイト列側の 2 つは Phase B4 で足した。ソルト・IV・暗号文は文字列ではないので
 * UTF-8 版を通せない（TextDecoder が不正なバイト列を U+FFFD に潰す）。
 * 1 文字ずつ足すループをこの 1 か所に閉じ込めるため、UTF-8 版をその上に載せている。
 */

export function toBase64Bytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(`toBase64Bytes: Uint8Array ではありません: ${typeof bytes}`);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64Bytes(b64) {
  if (typeof b64 !== "string") {
    throw new TypeError(`fromBase64Bytes: 文字列ではありません: ${typeof b64}`);
  }
  const binary = atob(b64);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

export function toBase64Utf8(text) {
  if (typeof text !== "string") {
    throw new TypeError(`toBase64Utf8: 文字列ではありません: ${typeof text}`);
  }
  return toBase64Bytes(new TextEncoder().encode(text));
}

export function fromBase64Utf8(b64) {
  if (typeof b64 !== "string") {
    throw new TypeError(`fromBase64Utf8: 文字列ではありません: ${typeof b64}`);
  }
  return new TextDecoder().decode(fromBase64Bytes(b64));
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test tests/base64.test.js`
Expected: PASS（既存の往復テストも含めて全件）

- [ ] **Step 5: commit**

```bash
git add assets/js/base64.js tests/base64.test.js
git commit -m "Add a byte-level entry point to the base64 helpers"
```

---

## Task 2: crypto.js — 封筒 JSON の codec

**Files:**
- Create: `assets/js/crypto.js`
- Test: `tests/crypto.test.js`

**Interfaces:**
- Consumes: Task 1 の `toBase64Bytes` / `fromBase64Bytes`
- Produces:
  - `ITERATIONS = 600000` / `SALT_BYTES = 16` / `IV_BYTES = 12`
  - `class DecryptError extends Error`（`.reason` は `"wrong-key" | "corrupt" | "malformed"`）
  - `randomBytes(n: number) → Uint8Array`
  - `deriveKey(passphrase: string, salt: Uint8Array, iterations: number) → Promise<CryptoKey>`
  - `exportKeyBytes(key: CryptoKey) → Promise<Uint8Array>` / `importKeyBytes(bytes: Uint8Array) → Promise<CryptoKey>`
  - `isEnvelope(value: unknown) → boolean`
  - `createCodec({ key, salt, iterations, random }) → { encode(data) → Promise<envelope>, decode(value) → Promise<{data, outerStampMismatch}> }`
  - `passthroughCodec`（`encode` は恒等、`decode` は `{data: value, outerStampMismatch: false}`）

WebCrypto は Node 20 以降 `globalThis.crypto.subtle` にあるので、**モックを作らず本物の暗号でテストする**。

- [ ] **Step 1: 失敗するテストを書く**

`tests/crypto.test.js` を新規作成する。

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  ITERATIONS,
  SALT_BYTES,
  IV_BYTES,
  DecryptError,
  randomBytes,
  deriveKey,
  exportKeyBytes,
  importKeyBytes,
  isEnvelope,
  createCodec,
  passthroughCodec,
} from "../assets/js/crypto.js";

const SALT = new Uint8Array(SALT_BYTES).fill(7);
const DATA = {
  updatedAt: "2026-08-10T00:00:00.000Z",
  days: ["8/12"],
  events: [{ id: "ev-1", title: "出国フライト 🛫", notes: "便名: TG641" }],
};

async function codecFor(passphrase, { salt = SALT, iterations = 1000 } = {}) {
  // テストでは iterations を落とす。600,000 回を 1 件ごとに回すと時間がかかりすぎ、
  // 検証したいのは反復回数ではなく往復と失敗の見分けだから
  const key = await deriveKey(passphrase, salt, iterations);
  return createCodec({ key, salt, iterations });
}

test("設計書 §6.2 の定数が一致している", () => {
  assert.equal(ITERATIONS, 600000);
  assert.equal(SALT_BYTES, 16);
  assert.equal(IV_BYTES, 12);
});

test("暗号化して復号すると元に戻る（日本語と絵文字を含む）", async () => {
  const codec = await codecFor("ひみつの合言葉");
  const envelope = await codec.encode(DATA);
  const { data, outerStampMismatch } = await codec.decode(envelope);
  assert.deepEqual(data, DATA);
  assert.equal(outerStampMismatch, false);
});

test("封筒は updatedAt を暗号文の外にも持つ", async () => {
  const codec = await codecFor("ひみつの合言葉");
  const envelope = await codec.encode(DATA);
  // assertRemoteNotAhead がここを読む。読めなくなると競合検出が死ぬ
  assert.equal(envelope.updatedAt, DATA.updatedAt);
  assert.equal(envelope.kdf.iter, 1000);
  assert.equal(typeof envelope.kdf.salt, "string");
  assert.equal(typeof envelope.iv, "string");
  assert.equal(typeof envelope.ct, "string");
});

test("封筒に行き先も宿も出ない", async () => {
  const codec = await codecFor("ひみつの合言葉");
  const envelope = await codec.encode(DATA);
  const text = JSON.stringify(envelope);
  assert.ok(!text.includes("出国フライト"));
  assert.ok(!text.includes("TG641"));
  assert.ok(!text.includes("ev-1"));
});

test("IV は暗号化のたびに変わる", async () => {
  const codec = await codecFor("ひみつの合言葉");
  const a = await codec.encode(DATA);
  const b = await codec.encode(DATA);
  // 鍵と組で IV を使い回すと AES-GCM は平文が漏れる
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test("違う合言葉の鍵では wrong-key で弾く", async () => {
  const mine = await codecFor("正しい合言葉", { salt: SALT });
  const other = await codecFor("違う合言葉", { salt: new Uint8Array(SALT_BYTES).fill(9) });
  const envelope = await other.encode(DATA);
  await assert.rejects(
    () => mine.decode(envelope),
    (error) => error instanceof DecryptError && error.reason === "wrong-key"
  );
});

test("kdf は同じだが暗号文が壊れていれば corrupt で弾く", async () => {
  const codec = await codecFor("ひみつの合言葉");
  const envelope = await codec.encode(DATA);
  // 認証タグ検証が失敗するように 1 バイト分を差し替える
  const broken = { ...envelope, ct: envelope.ct.replace(/^./, (c) => (c === "A" ? "B" : "A")) };
  await assert.rejects(
    () => codec.decode(broken),
    (error) => error instanceof DecryptError && error.reason === "corrupt"
  );
});

test("内側と外側の updatedAt が食い違えば内側を正として知らせる", async () => {
  const codec = await codecFor("ひみつの合言葉");
  const envelope = await codec.encode(DATA);
  // 外側は認証されないので、こう書き換えても GCM は気付かない
  const tampered = { ...envelope, updatedAt: "2030-01-01T00:00:00.000Z" };
  const { data, outerStampMismatch } = await codec.decode(tampered);
  assert.equal(outerStampMismatch, true);
  assert.equal(data.updatedAt, DATA.updatedAt);
});

test("ct を持たない値は平文として素通しする（移行の 1 回）", async () => {
  const codec = await codecFor("ひみつの合言葉");
  const { data, outerStampMismatch } = await codec.decode(DATA);
  assert.deepEqual(data, DATA);
  assert.equal(outerStampMismatch, false);
});

test("isEnvelope は ct の有無で判定する", () => {
  assert.equal(isEnvelope({ ct: "AAA" }), true);
  assert.equal(isEnvelope(DATA), false);
  assert.equal(isEnvelope(null), false);
  assert.equal(isEnvelope([{ ct: "AAA" }]), false);
});

test("鍵は書き出して読み戻しても同じ暗号文を復号できる", async () => {
  const key = await deriveKey("ひみつの合言葉", SALT, 1000);
  const envelope = await createCodec({ key, salt: SALT, iterations: 1000 }).encode(DATA);

  const restored = await importKeyBytes(await exportKeyBytes(key));
  const { data } = await createCodec({ key: restored, salt: SALT, iterations: 1000 }).decode(envelope);
  assert.deepEqual(data, DATA);
});

test("randomBytes は指定の長さを返し、毎回変わる", () => {
  assert.equal(randomBytes(IV_BYTES).length, IV_BYTES);
  assert.notDeepEqual(randomBytes(16), randomBytes(16));
});

test("素通しの codec は何も変えない", async () => {
  assert.deepEqual(await passthroughCodec.encode(DATA), DATA);
  assert.deepEqual(await passthroughCodec.decode(DATA), { data: DATA, outerStampMismatch: false });
});

test("DecryptError は合言葉も鍵も文言に載せない", async () => {
  const mine = await codecFor("正しい合言葉");
  const other = await codecFor("ひみつのパスワード", { salt: new Uint8Array(SALT_BYTES).fill(3) });
  const envelope = await other.encode(DATA);
  const error = await mine.decode(envelope).catch((e) => e);
  assert.ok(!error.message.includes("正しい合言葉"));
  assert.ok(!error.message.includes("ひみつのパスワード"));
});
```

- [ ] **Step 2: 失敗することを確認する**

Run: `node --test tests/crypto.test.js`
Expected: FAIL。`Cannot find module '../assets/js/crypto.js'`

- [ ] **Step 3: 実装する**

`assets/js/crypto.js` を新規作成する。

```js
/**
 * 同期する JSON の暗号化と復号。設計書 §6.2 に対応。
 *
 * この層は store も DOM も fetch も知らない。鍵を受け取って封筒 JSON を作る／
 * 開けるだけで、鍵をどこに置くかは auth.js、いつ通すかは sync.js の担当。
 *
 * ファイルを「生バイト列」ではなく封筒 JSON にしているのは、B1 の競合検出を
 * 生かすため。sync.js の assertRemoteNotAhead() は GET した本文を JSON.parse して
 * updatedAt を読む。中身が不透明なバイト列だと読めず、突き合わせを省いたまま
 * 公開が通る ── 「相手が 30 分編集している間にこちらが公開する」という現実の競合を
 * 捕まえる唯一のガードが常時オフになる。updatedAt を暗号文の外に複製すれば、
 * 漏れるのは最終更新時刻だけで、行き先も時刻も宿も ct の中に残る。
 */

import { toBase64Bytes, fromBase64Bytes } from "./base64.js";

export const ITERATIONS = 600000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

/**
 * 復号できなかった。reason で直し方が変わるので、呼び出し側はこれで文言を分ける。
 *
 * - "wrong-key"  … 封筒の kdf が手元の鍵素材と違う。別の合言葉で暗号化されている
 * - "corrupt"    … kdf は一致するが GCM の認証タグ検証が失敗した。データが壊れている
 * - "malformed"  … base64 や JSON として読めない
 *
 * GCM 単体では「合言葉が違う」と「壊れている」を区別できない。kdf の一致で
 * 前者を切り分けているのは当て推量ではなく、手元の鍵素材との比較による。
 *
 * message に合言葉も鍵も載せないこと（設計書 §9）。
 */
export class DecryptError extends Error {
  constructor(reason, message, cause) {
    super(message, { cause });
    this.name = "DecryptError";
    this.reason = reason;
  }
}

const subtle = () => globalThis.crypto.subtle;

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 合言葉から AES-GCM の鍵を導出する。
 * extractable にしているのは auth.js が localStorage へ書き出すため
 * （書き出せないと端末ごとに毎回 PBKDF2 600,000 回を回すことになる）。
 */
export async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKeyBytes(key) {
  return new Uint8Array(await subtle().exportKey("raw", key));
}

export async function importKeyBytes(bytes) {
  return subtle().importKey("raw", bytes, "AES-GCM", true, ["encrypt", "decrypt"]);
}

/** 封筒か。ct を持つかどうかだけで見る。持たない値は平文として扱う。 */
export function isEnvelope(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.ct === "string"
  );
}

/**
 * 鍵素材から codec を組み立てる。
 *
 * salt / iterations をファイルの kdf からではなく引数で受けるのが要点。
 * ファイルごとにソルトを引くと、packing.json を足した時点で events.json と
 * 別の鍵になり、ページを移動するたびに PBKDF2 600,000 回が走る（設計書 §6.3）。
 */
export function createCodec({ key, salt, iterations = ITERATIONS, random = randomBytes }) {
  const saltB64 = toBase64Bytes(salt);

  async function encode(data) {
    const iv = random(IV_BYTES);
    const plain = new TextEncoder().encode(JSON.stringify(data));
    const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, plain);
    return {
      // 外側の updatedAt は認証されない複製。正は ct の中にある
      updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null,
      kdf: { salt: saltB64, iter: iterations },
      iv: toBase64Bytes(iv),
      ct: toBase64Bytes(new Uint8Array(ct)),
    };
  }

  async function decode(value) {
    // 平文はそのまま返す。切り替え当日にこの経路を 1 回だけ通る
    if (!isEnvelope(value)) return { data: value, outerStampMismatch: false };

    if (value.kdf?.salt !== saltB64 || value.kdf?.iter !== iterations) {
      throw new DecryptError("wrong-key", "別の合言葉で暗号化されています");
    }

    let iv;
    let ct;
    try {
      iv = fromBase64Bytes(value.iv);
      ct = fromBase64Bytes(value.ct);
    } catch (error) {
      throw new DecryptError("malformed", "暗号文の形式が壊れています", error);
    }

    let plain;
    try {
      plain = await subtle().decrypt({ name: "AES-GCM", iv }, key, ct);
    } catch (error) {
      // kdf は一致しているので、合言葉ではなく中身が壊れている見込み
      throw new DecryptError("corrupt", "データが壊れています", error);
    }

    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(plain));
    } catch (error) {
      throw new DecryptError("malformed", "復号できましたが JSON として読めません", error);
    }

    // 外側は GCM の認証タグの外なので、改竄も破損も検知できない。内側を正とする
    const outerStampMismatch = value.updatedAt !== (data?.updatedAt ?? null);
    return { data, outerStampMismatch };
  }

  return { encode, decode };
}

/**
 * 何もしない codec。createSync の既定値で、B1 までの挙動（平文で読み書き）を保つ。
 * 暗号化を有効にしていない経路とテストが、封筒を意識せずに済む。
 */
export const passthroughCodec = {
  async encode(data) {
    return data;
  },
  async decode(value) {
    return { data: value, outerStampMismatch: false };
  },
};
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test tests/crypto.test.js`
Expected: PASS（14 件）

- [ ] **Step 5: commit**

```bash
git add assets/js/crypto.js tests/crypto.test.js
git commit -m "Add the envelope codec that keeps updatedAt outside the ciphertext"
```

---

## Task 3: auth.js — 鍵の保存と一生

**Files:**
- Create: `assets/js/auth.js`
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: Task 2 の `deriveKey` / `exportKeyBytes` / `importKeyBytes` / `randomBytes` / `createCodec` / `ITERATIONS` / `SALT_BYTES`、Task 1 の `toBase64Bytes` / `fromBase64Bytes`、既存の `createStore`
- Produces:
  - `readKeyMaterial(store) → {salt: string, iter: number, key: string} | null`
  - `writeKeyMaterial(store, material) → void`
  - `clearKey(store) → void` / `hasKey(store) → boolean`
  - `unlock(store, passphrase, kdf | null) → Promise<codec>`（`kdf` が null なら新しいソルトを生成）
  - `loadCodec(store) → Promise<codec | null>`
  - `kdfMatches(store, kdf) → boolean`

`token.js` と対称に置く。保存キー `tp:key` を知るのはこのファイルだけ。

- [ ] **Step 1: 失敗するテストを書く**

`tests/auth.test.js` を新規作成する。

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../assets/js/store.js";
import { SALT_BYTES, deriveKey, createCodec } from "../assets/js/crypto.js";
import { toBase64Bytes } from "../assets/js/base64.js";
import {
  readKeyMaterial,
  writeKeyMaterial,
  clearKey,
  hasKey,
  unlock,
  loadCodec,
  kdfMatches,
} from "../assets/js/auth.js";

/** localStorage の最小スタブ。中身を直接覗いてキー名を検査する。 */
function fakeBackend() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const DATA = { updatedAt: "2026-08-10T00:00:00.000Z", days: ["8/12"], events: [] };

test("鍵が無ければ hasKey は false、loadCodec は null", async () => {
  const store = createStore(fakeBackend());
  assert.equal(hasKey(store), false);
  assert.equal(readKeyMaterial(store), null);
  assert.equal(await loadCodec(store), null);
});

test("unlock すると鍵が残り、次の起動は導出なしで復号できる", async () => {
  const backend = fakeBackend();
  const store = createStore(backend);

  const codec = await unlock(store, "ひみつの合言葉", { salt: toBase64Bytes(new Uint8Array(SALT_BYTES).fill(4)), iter: 1000 });
  const envelope = await codec.encode(DATA);

  // 別の store インスタンス（＝ページを開き直した状態）から読み戻す
  const reopened = await loadCodec(createStore(backend));
  const { data } = await reopened.decode(envelope);
  assert.deepEqual(data, DATA);
});

test("kdf が無ければ新しいソルトを生成する（移行の初回）", async () => {
  const store = createStore(fakeBackend());
  await unlock(store, "ひみつの合言葉", null);
  const material = readKeyMaterial(store);
  assert.equal(typeof material.salt, "string");
  assert.equal(material.iter, 600000);
});

test("保存キーは tp:key ひとつだけ", async () => {
  const backend = fakeBackend();
  const store = createStore(backend);
  await unlock(store, "ひみつの合言葉", { salt: toBase64Bytes(new Uint8Array(SALT_BYTES)), iter: 1000 });
  assert.deepEqual([...backend.map.keys()], ["tp:key"]);
});

test("合言葉そのものは保存しない", async () => {
  const backend = fakeBackend();
  const store = createStore(backend);
  await unlock(store, "ひみつの合言葉", { salt: toBase64Bytes(new Uint8Array(SALT_BYTES)), iter: 1000 });
  const stored = backend.map.get("tp:key");
  assert.ok(!stored.includes("ひみつの合言葉"));
});

test("clearKey で消える", async () => {
  const store = createStore(fakeBackend());
  await unlock(store, "ひみつの合言葉", null);
  assert.equal(hasKey(store), true);
  clearKey(store);
  assert.equal(hasKey(store), false);
});

test("壊れた値は null に落ちる（例外にしない）", () => {
  const backend = fakeBackend();
  backend.setItem("tp:key", "これは形式が違う");
  const store = createStore(backend);
  assert.equal(readKeyMaterial(store), null);
  assert.equal(hasKey(store), false);
});

test("iter が数値でない値も null に落ちる", () => {
  const backend = fakeBackend();
  backend.setItem("tp:key", "AAAA.abc.BBBB");
  assert.equal(readKeyMaterial(createStore(backend)), null);
});

test("kdfMatches は封筒の kdf と手元の鍵素材を比べる", async () => {
  const store = createStore(fakeBackend());
  const salt = toBase64Bytes(new Uint8Array(SALT_BYTES).fill(5));
  await unlock(store, "ひみつの合言葉", { salt, iter: 1000 });

  assert.equal(kdfMatches(store, { salt, iter: 1000 }), true);
  assert.equal(kdfMatches(store, { salt: toBase64Bytes(new Uint8Array(SALT_BYTES).fill(6)), iter: 1000 }), false);
  assert.equal(kdfMatches(store, { salt, iter: 600000 }), false);
  // 平文には kdf が無い。突き合わせるものが無いので「食い違っていない」と答える
  assert.equal(kdfMatches(store, null), true);
});

test("writeKeyMaterial / readKeyMaterial が往復する", () => {
  const store = createStore(fakeBackend());
  const material = { salt: "c2FsdA==", iter: 600000, key: "a2V5" };
  writeKeyMaterial(store, material);
  assert.deepEqual(readKeyMaterial(store), material);
});
```

- [ ] **Step 2: 失敗することを確認する**

Run: `node --test tests/auth.test.js`
Expected: FAIL。`Cannot find module '../assets/js/auth.js'`

- [ ] **Step 3: 実装する**

`assets/js/auth.js` を新規作成する。

```js
/**
 * 合言葉から導いた鍵の置き場所。crypto.js の上に載るだけの薄い層。
 * token.js と同じ形にしてある（設計書 §6.3、§5.4）。
 *
 * ここに閉じ込める理由も token.js と同じ 2 つ。
 *
 * 1. キー名（`tp:key`）を 1 か所にする
 * 2. 秘密の出口を 1 か所にする。読んだ値は crypto.js の importKeyBytes にしか渡さない。
 *    ログにも DOM にも例外文にも出さないこと
 *
 * store.read / write ではなく readText / writeText を使うのも同じ理由で、
 * read は壊れた値を JSON.parse に掛けるので SyntaxError の文言に中身の先頭が
 * 埋め込まれ、それが console.warn へ出る。区切り文字に "." を使うのは
 * base64 が "+/=" は含んでも "." は含まないため（JSON を通さずに 3 つを詰められる）。
 *
 * 鍵は sessionStorage ではなく localStorage に置く。タブを閉じるたびに再入力に
 * なると、旅行中の現地で「合言葉を忘れた」が起きやすい ── 端末盗難より
 * そちらのほうが現実的な危険だと判断した（設計書 §6.3）。
 */

import {
  ITERATIONS,
  SALT_BYTES,
  createCodec,
  deriveKey,
  exportKeyBytes,
  importKeyBytes,
  randomBytes,
} from "./crypto.js";
import { toBase64Bytes, fromBase64Bytes } from "./base64.js";

const KEY = "key";

/** 使える鍵素材だけを返す（無い・壊れているなら null）。 */
export function readKeyMaterial(store) {
  const raw = store.readText(KEY);
  if (typeof raw !== "string" || raw === "") return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  const [salt, iterText, key] = parts;
  const iter = Number(iterText);
  if (!salt || !key || !Number.isInteger(iter) || iter <= 0) return null;

  return { salt, iter, key };
}

export function writeKeyMaterial(store, { salt, iter, key }) {
  store.writeText(KEY, `${salt}.${iter}.${key}`);
}

export function clearKey(store) {
  store.remove(KEY);
}

/** 遷移ガードの判断に使う。store.has ではなく中身で見る（壊れた値を「有る」にしない）。 */
export function hasKey(store) {
  return readKeyMaterial(store) !== null;
}

/**
 * 封筒の kdf が手元の鍵素材と一致するか。
 *
 * 「合言葉が違う」と「データが壊れている」を見分けるために使う（設計書 §9）。
 * kdf が無い値（＝平文）は突き合わせるものが無いので true を返す ──
 * 移行前のファイルを「別の合言葉」と誤って言わないため。
 */
export function kdfMatches(store, kdf) {
  if (kdf == null) return true;
  const material = readKeyMaterial(store);
  if (material === null) return false;
  return kdf.salt === material.salt && kdf.iter === material.iter;
}

/**
 * 合言葉を鍵に変えて保存し、codec を返す。
 *
 * kdf が null なら新しいソルトを生成する。これを通るのは、まだ平文のファイルに
 * 対して初めて合言葉を設定するとき（切り替え当日の 1 回）だけ。
 */
export async function unlock(store, passphrase, kdf) {
  const salt = kdf?.salt ? fromBase64Bytes(kdf.salt) : randomBytes(SALT_BYTES);
  const iterations = kdf?.iter ?? ITERATIONS;

  const key = await deriveKey(passphrase, salt, iterations);
  writeKeyMaterial(store, {
    salt: toBase64Bytes(salt),
    iter: iterations,
    key: toBase64Bytes(await exportKeyBytes(key)),
  });

  return createCodec({ key, salt, iterations });
}

/**
 * 保存済みの鍵から codec を組み立てる（無ければ null）。
 * PBKDF2 はここでは走らない。それが鍵をキャッシュしている理由。
 */
export async function loadCodec(store) {
  const material = readKeyMaterial(store);
  if (material === null) return null;

  const salt = fromBase64Bytes(material.salt);
  const key = await importKeyBytes(fromBase64Bytes(material.key));
  return createCodec({ key, salt, iterations: material.iter });
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test tests/auth.test.js`
Expected: PASS（10 件）

- [ ] **Step 5: commit**

```bash
git add assets/js/auth.js tests/auth.test.js
git commit -m "Cache the derived key so PBKDF2 runs once per device"
```

---

## Task 4: createSync の注入口を 5 つ同時に足す

**Files:**
- Modify: `assets/js/sync.js`
- Test: `tests/sync.test.js`

**Interfaces:**
- Consumes: Task 2 の `passthroughCodec`
- Produces: `DEFAULT_CONFIG` に `draftKey` / `baseKey` / `validate` / `commitMessage` / `codec` が加わる。`createSync()` の戻り値の形は変わらないが、`load()` の返り値に `outerStampMismatch: boolean` が加わる

**この 5 つは一度に足すこと。** 設計書 §13 の警告どおり、一部だけを注入可能にすると持ち物の下書きが `tp:events` を上書きし、旅程の未公開の編集がその瞬間に消える。人が気付くのは次に旅程ページを開いたときで、そのときには失われている。

- [ ] **Step 1: 失敗するテストを書く**

`tests/sync.test.js` の末尾に追記する（既存のヘルパー名が違う場合は、そのファイルの流儀に合わせて読み替えること）。

```js
import { deriveKey, createCodec, SALT_BYTES, DecryptError } from "../assets/js/crypto.js";
import { validateEvents } from "../assets/js/validate.js";

const B4_DATA = {
  updatedAt: "2026-08-10T00:00:00.000Z",
  days: ["8/12", "8/13"],
  events: [
    { id: "ev-1", cat: "cat-move", title: "出国", allDay: false,
      startDay: 0, endDay: 0, start: 10, end: 12,
      location: "羽田", lat: 35.55, lng: 139.78, url: "", notes: "", image: "", imagePos: "" },
  ],
};

async function b4Codec() {
  const salt = new Uint8Array(SALT_BYTES).fill(2);
  const key = await deriveKey("ひみつの合言葉", salt, 1000);
  return createCodec({ key, salt, iterations: 1000 });
}

/** fetch と GitHub API の最小スタブ。text には PUT された本文が入る。 */
function fakeRemote(initialText) {
  const state = { text: initialText, puts: [] };
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith("https://api.github.com")) {
      if ((options.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sha: "sha-1", content: btoa(unescape(encodeURIComponent(state.text))) }),
        };
      }
      const body = JSON.parse(options.body);
      state.puts.push(body);
      state.text = decodeURIComponent(escape(atob(body.content)));
      return { ok: true, status: 200, json: async () => ({ commit: { html_url: "https://example/commit" } }) };
    }
    return { ok: true, status: 200, json: async () => JSON.parse(state.text) };
  };
  return { state, fetchImpl };
}

test("codec を注入すると封筒を PUT し、読むときは復号する", async () => {
  const codec = await b4Codec();
  const store = createStore(fakeBackend());
  const { state, fetchImpl } = fakeRemote(JSON.stringify(B4_DATA));

  const sync = createSync({
    store,
    fetchImpl,
    config: { ...DEFAULT_CONFIG, codec },
  });

  writeToken(store, "ghp_test");
  const loaded = await sync.load();
  assert.deepEqual(loaded.data.events, B4_DATA.events);  // 平文リモートを素通しで読めた

  await sync.publish(loaded.data);

  const published = JSON.parse(state.text);
  assert.equal(typeof published.ct, "string");            // 封筒になった
  assert.ok(!state.text.includes("出国"));                // 行き先が出ていない
  assert.equal(typeof published.updatedAt, "string");     // 外側の updatedAt は残る
});

test("封筒になったリモートを次の起動で読める", async () => {
  const codec = await b4Codec();
  const envelope = await codec.encode(B4_DATA);
  const { fetchImpl } = fakeRemote(JSON.stringify(envelope));

  const sync = createSync({
    store: createStore(fakeBackend()),
    fetchImpl,
    config: { ...DEFAULT_CONFIG, codec },
  });

  const loaded = await sync.load();
  assert.deepEqual(loaded.data.events, B4_DATA.events);
  assert.equal(loaded.outerStampMismatch, false);
});

test("外側の updatedAt が書き換えられていれば load が知らせる", async () => {
  const codec = await b4Codec();
  const envelope = await codec.encode(B4_DATA);
  const { fetchImpl } = fakeRemote(JSON.stringify({ ...envelope, updatedAt: "2030-01-01T00:00:00.000Z" }));

  const sync = createSync({
    store: createStore(fakeBackend()),
    fetchImpl,
    config: { ...DEFAULT_CONFIG, codec },
  });

  const loaded = await sync.load();
  assert.equal(loaded.outerStampMismatch, true);
  assert.equal(loaded.data.updatedAt, B4_DATA.updatedAt);  // 内側が正
});

test("復号できないリモートは DecryptError のまま投げる（握らない）", async () => {
  const mine = await b4Codec();
  const otherSalt = new Uint8Array(SALT_BYTES).fill(8);
  const other = createCodec({ key: await deriveKey("違う合言葉", otherSalt, 1000), salt: otherSalt, iterations: 1000 });
  const { fetchImpl } = fakeRemote(JSON.stringify(await other.encode(B4_DATA)));

  const sync = createSync({
    store: createStore(fakeBackend()),
    fetchImpl,
    config: { ...DEFAULT_CONFIG, codec: mine },
  });

  await assert.rejects(() => sync.load(), (e) => e instanceof DecryptError && e.reason === "wrong-key");
});

test("突き合わせは封筒の外側の updatedAt で効く", async () => {
  const codec = await b4Codec();
  const store = createStore(fakeBackend());
  const { state, fetchImpl } = fakeRemote(JSON.stringify(await codec.encode(B4_DATA)));

  const sync = createSync({ store, fetchImpl, config: { ...DEFAULT_CONFIG, codec } });
  writeToken(store, "ghp_test");
  await sync.load();

  // 別端末が先に公開した状況を作る（外側の updatedAt だけ進める）
  const ahead = { ...JSON.parse(state.text), updatedAt: "2031-01-01T00:00:00.000Z" };
  state.text = JSON.stringify(ahead);

  await assert.rejects(() => sync.publish(B4_DATA), (e) => e.status === 409);
  assert.equal(state.puts.length, 0);  // PUT は飛んでいない
});

test("draftKey / baseKey を差し替えると別のキーに書く", async () => {
  const backend = fakeBackend();
  const store = createStore(backend);
  const { fetchImpl } = fakeRemote(JSON.stringify(B4_DATA));

  const sync = createSync({
    store,
    fetchImpl,
    config: { ...DEFAULT_CONFIG, draftKey: "packing", baseKey: "packing-base" },
  });
  await sync.load();

  assert.ok(backend.map.has("tp:packing"));
  assert.ok(backend.map.has("tp:packing-base"));
  assert.ok(!backend.map.has("tp:events"));       // 旅程の下書きを踏まない
  assert.ok(!backend.map.has("tp:events-base"));
});

test("validate を差し替えると旅程以外も通せる", async () => {
  const packing = { updatedAt: "2026-08-10T00:00:00.000Z", groups: [] };
  const { fetchImpl } = fakeRemote(JSON.stringify(packing));

  const sync = createSync({
    store: createStore(fakeBackend()),
    fetchImpl,
    config: {
      ...DEFAULT_CONFIG,
      draftKey: "packing",
      baseKey: "packing-base",
      validate: (data) => data,          // 持ち物用の検証器の代わり
      commitMessage: () => "Update packing from the browser",
    },
  });

  const loaded = await sync.load();
  assert.deepEqual(loaded.data, packing);
});

test("commitMessage を差し替えるとコミット文が変わる", async () => {
  const store = createStore(fakeBackend());
  const { state, fetchImpl } = fakeRemote(JSON.stringify(B4_DATA));
  const sync = createSync({
    store,
    fetchImpl,
    config: { ...DEFAULT_CONFIG, commitMessage: () => "Custom message" },
  });
  writeToken(store, "ghp_test");
  await sync.load();
  await sync.publish(B4_DATA);
  assert.equal(state.puts.at(-1).message, "Custom message");
});

test("既定値は B1 の挙動と完全に一致する（平文・events キー・従来の文言）", async () => {
  const backend = fakeBackend();
  const store = createStore(backend);
  const { state, fetchImpl } = fakeRemote(JSON.stringify(B4_DATA));

  const sync = createSync({ store, fetchImpl });   // config を渡さない
  writeToken(store, "ghp_test");
  await sync.load();
  await sync.publish(B4_DATA);

  assert.ok(backend.map.has("tp:events"));
  assert.ok(backend.map.has("tp:events-base"));
  assert.equal(state.puts.at(-1).message, "Update itinerary from the browser (1 event)");
  assert.equal(JSON.parse(state.text).ct, undefined);   // 平文のまま
});
```

- [ ] **Step 2: 失敗することを確認する**

Run: `node --test tests/sync.test.js`
Expected: FAIL。`codec` / `draftKey` などが無視されるため、封筒にならず `tp:events` に書かれる

- [ ] **Step 3: 実装する**

`assets/js/sync.js` を次のとおり変更する。

冒頭の import に足す。

```js
import { passthroughCodec } from "./crypto.js";
```

`DRAFT_KEY` / `BASE_KEY` のモジュール定数を消し、そのコメントを `DEFAULT_CONFIG` へ移す。`DEFAULT_CONFIG` を差し替える。

```js
/**
 * 公開先と、ファイルごとに違う 5 つ。ここ以外に owner / repo / branch / path を書かないこと。
 *
 * path は 2 つの意味を兼ねている: 読み込みでは「ページからの相対 URL」、
 * Contents API では「リポジトリのルートからのパス」。今はページがリポジトリ直下に
 * 置かれているので一致している。ページをサブディレクトリへ移すなら分けること。
 *
 * draftKey / baseKey / validate / commitMessage / codec は 2 つ目の JSON
 * （packing.json、comments.json）のために外へ出してある。**5 つは必ず揃えて渡すこと。**
 * 一部だけを差し替えると、その JSON が自分の検証を通ったうえで
 * store.write(draftKey, …) が旅程の既定キーへ書き、旅程の未公開の編集が
 * その瞬間に消える（設計書 §13）。
 *
 * baseKey に入る時刻は公開した端末の時計で押される。押す端末が複数あるので、
 * 順序関係は保たれない ── A の時計が 10 分遅れていれば、A があとから公開した版の
 * updatedAt は B の版より古くなり、こちらの base（B の版を取り込んだ時刻）を
 * 下回る。突き合わせは「進んでいない」と判断し、A の公開を黙って上書きする。
 * 免疫を付けるには内容のハッシュか sha が要るが、読み込みはトークン無しの
 * 素の fetch なので sha が手に入らない（設計書 §13 の残存リスク）。
 * 上書きしてもコミットは git 履歴に残るので、復旧はできる。
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
};
```

`createSync` の先頭で config を既定値に重ねる。**部分的な config でも owner / repo が落ちないよう、必ずスプレッドで重ねること。**

```js
export function createSync({ store, fetchImpl = fetch, config = {}, now = () => Date.now() }) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { draftKey, baseKey, validate, commitMessage, codec } = cfg;
  const nowIso = () => new Date(now()).toISOString();
```

以降、`config.path` は `cfg.path` に、`DRAFT_KEY` は `draftKey`、`BASE_KEY` は `baseKey`、`validateEvents(...)` の呼び出し 5 か所はすべて `validate(...)` に置き換える。

`fetchRemote()` は生の JSON を返すままにし、復号は呼び出し側で行う（`adoptRemote` と `load` の両方が通るため）。復号を挟むヘルパーを足す。

```js
  /**
   * 取ってきた本文を復号する。平文（ct を持たない値）は素通しする ──
   * 切り替え当日にこの経路を 1 回だけ通る（設計書 §6.5）。
   *
   * DecryptError は握らずに投げる。「合言葉が違う」「壊れている」は
   * 直し方が違うので、呼び出し側が reason を見て文言を分ける（設計書 §9）。
   */
  async function fetchAndDecode() {
    return codec.decode(await fetchRemote());
  }
```

`load()` の中を書き換える。

```js
    let remote = null;
    let remoteOk = false;
    let fetchError = null;
    let outerStampMismatch = false;
    try {
      const decoded = await fetchAndDecode();
      remote = decoded.data;
      outerStampMismatch = decoded.outerStampMismatch;
      remoteOk = true;
    } catch (error) {
      // 取りに行けなかっただけ。手元のデータで動作を続ける（設計書 §5.2）。
      // ただし復号の失敗は別物 ── リモートは取れていて中身が読めないので、
      // 「オフラインです」と言うのは嘘になる。そのまま投げて呼び出し側に見せる
      if (error instanceof DecryptError) throw error;
      fetchError = error;
      console.warn("sync: 最新の旅程データを確認できませんでした", error);
    }
```

`DecryptError` を import に足す（`import { passthroughCodec, DecryptError } from "./crypto.js";`）。

`load()` が返す 3 か所の return に `outerStampMismatch` を足す。

```js
      return { data: remote, source, remoteUpdatedAt: stampOf(remote), outerStampMismatch };
...
    if (hasLocal) return { data: draft, source, remoteUpdatedAt: stampOf(remote), outerStampMismatch };
```

`adoptRemote()` を復号経由にする。

```js
  async function adoptRemote() {
    const { data } = await fetchAndDecode();
    const remote = validate(data);
    storeAdopted(remote);
    return remote;
  }
```

`publish()` を暗号化経由にする。順序を変えないこと（検証 → 時刻 → 暗号化 → GET → 突き合わせ → PUT → base）。

```js
  async function publish(data) {
    validate(data);

    // トークンは公開のたびに読む。createSync のあとに設定しても効くように
    const gh = createGitHub({
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
      token: readToken(store),
      fetchImpl,
    });

    const stamped = { ...data, updatedAt: nowIso() };
    // 暗号化は検証のあと。壊れたものを暗号文にすると、誰も中身を確かめられなくなる
    const envelope = await codec.encode(stamped);
    const text = `${JSON.stringify(envelope, null, 2)}\n`;
    const message = commitMessage(stamped);

    const current = await gh.getFile(cfg.path);
    // 送る前に突き合わせる。ここで投げれば PUT は一度も飛ばない。
    // 読むのは封筒の外側の updatedAt なので、暗号化しても無改造で効く（設計書 §6.2）
    const conflictChecked = assertRemoteNotAhead(current);

    const { commitUrl } = await gh.putFile({
      path: cfg.path,
      text,
      sha: current?.sha,
      message,
    });

    // 下書きと base には平文を入れる。鍵を失っても手元の未公開の編集は読める
    storeAdopted(stamped);
    return { commitUrl, conflictChecked };
  }
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test`
Expected: PASS（既存の `sync.test.js` を含めて全件。既存テストが `config` に部分オブジェクトを渡していれば、スプレッドで既定値が埋まるので通る）

- [ ] **Step 5: commit**

```bash
git add assets/js/sync.js tests/sync.test.js
git commit -m "Make createSync take the keys, validator, message, and codec together"
```

---

## Task 5: 読み込み失敗の分類を切り出し、復号の失敗を足す

**Files:**
- Create: `assets/js/load-error.js`
- Modify: `assets/js/schedule.js`, `assets/js/publish-ui.js`
- Test: `tests/load-error.test.js`, `tests/publish-ui.test.js`

> **2026-08-10 追記（レビューの Critical を受けて）**: 当初この計画は
> 「`createPublishUI()` の呼び出しを `load()` より前へ移す」とだけ書いていたが、
> **それでは何も変わらない。** `createPublishUI()` は要素を組み立てるだけで DOM に
> 挿入せず、実際にマウントするのは `start()` の中の `replaceChildren` だけ。
> その `start()` は `load()` の後ろにあるので、リモートが壊れた端末では
> 公開ボタンもトークン設定も現れないまま ── このタスクが存在する理由が未達だった。
> **マウントを `start()` から出すこと**（下記）。

**Interfaces:**
- Consumes: Task 2 の `DecryptError`、既存の `EventDataError`
- Produces: `DataFetchError` / `DataParseError`（`schedule.js` から移設）、`classifyLoadError(error) → {kind, message}`。`kind` は `"data" | "parse" | "fetch" | "wrong-key" | "corrupt" | "unknown"`

`schedule.js` はモジュール冒頭で `document.getElementById` を呼ぶので Node から import できず、今の `loadErrorMessage()` はテストできない。純粋な部分を切り出して検査できるようにする。

- [ ] **Step 1: 失敗するテストを書く**

`tests/load-error.test.js` を新規作成する。

```js
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
  assert.ok(!message.includes("合言葉が違います"));
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

test("どの分類でも合言葉や鍵の中身は文言に載らない", () => {
  for (const error of [
    new DecryptError("wrong-key", "別の合言葉で暗号化されています"),
    new DecryptError("corrupt", "データが壊れています"),
  ]) {
    const { message } = classifyLoadError(error);
    assert.ok(!/tp:key/.test(message));
  }
});
```

- [ ] **Step 2: 失敗することを確認する**

Run: `node --test tests/load-error.test.js`
Expected: FAIL。`Cannot find module '../assets/js/load-error.js'`

- [ ] **Step 3: 実装する**

`assets/js/load-error.js` を新規作成する。

```js
/**
 * 旅程の読み込みに失敗したときの分類と文言。純粋関数だけを置く。
 *
 * schedule.js はモジュール冒頭で document を触るので Node から import できない。
 * ここに切り出すことで、「直し方が違う失敗は違う文言で言う」という約束を
 * node --test で守らせられる。
 *
 * 合言葉・鍵・トークンを文言に載せないこと（設計書 §9）。
 */

import { EventDataError } from "./validate.js";
import { DecryptError } from "./crypto.js";

/** HTTP エラー・通信断。取りに行けなかった、という種類の失敗。 */
export class DataFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataFetchError";
  }
}

/** 取れたが JSON として読めなかった。404 が HTML で返る場合もここに来る。 */
export class DataParseError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "DataParseError";
  }
}

export function classifyLoadError(error) {
  if (error instanceof EventDataError) {
    return {
      kind: "data",
      message:
        "旅程データ（assets/data/events.json）の内容に問題があります。\n" +
        "再読み込みでは直りません。下記を直してから読み込み直してください。\n\n" +
        error.message,
    };
  }

  if (error instanceof DecryptError) {
    if (error.reason === "wrong-key") {
      return {
        kind: "wrong-key",
        message:
          "この端末の合言葉では旅程を開けません。\n" +
          "別の合言葉で暗号化されています。index.html に戻って入れ直してください。",
      };
    }
    // corrupt と malformed をまとめるのは、利用者から見た直し方が同じだから。
    // どちらも「合言葉は合っているのに中身が読めない」で、押す手は公開し直し
    return {
      kind: "corrupt",
      message:
        "旅程データを復号できましたが、中身が壊れています。\n" +
        "合言葉は合っている見込みです。旅程を持っている端末から公開し直してください。\n\n" +
        error.message,
    };
  }

  if (error instanceof DataParseError) {
    return {
      kind: "parse",
      message:
        "旅程データ（assets/data/events.json）を JSON として読めませんでした。\n" +
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
        "旅程データ（assets/data/events.json）を取得できませんでした。\n" +
        "通信状況を確認してページを再読み込みするか、" +
        "手元で開いている場合は file:// ではなくローカルサーバー" +
        "（python3 -m http.server）経由でアクセスしてください。\n\n" +
        error.message,
    };
  }

  return {
    kind: "unknown",
    message:
      "旅程の表示中に想定外のエラーが発生しました。\n" +
      "データの読み込み自体は完了している可能性があります。" +
      "詳細はブラウザのコンソールを確認してください。\n\n" +
      `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
  };
}
```

`assets/js/schedule.js` を書き換える。`DataFetchError` / `DataParseError` のクラス定義（15〜29 行目）と `loadErrorMessage()`（217〜250 行目）を削除し、import に置き換える。

```js
import { classifyLoadError, DataFetchError, DataParseError } from "./load-error.js";
import { hasKey, loadCodec, clearKey } from "./auth.js";
import { DEFAULT_CONFIG } from "./sync.js";
```

`showLoadError` を差し替える。

```js
function showLoadError(error) {
  const { message } = classifyLoadError(error);
  els.cal.innerHTML = `<p class="ferror ferror--block">${escapeHtml(message)}</p>`;
}
```

`main()` の前半を書き換える。**鍵の確認 → `publish-ui` の組み立て → `load()` の順にする。**

```js
async function main() {
  injectSprite();

  const store = createStore();

  // 鍵が無ければ旅程は復号できない。合言葉を入れてもらうため入口へ戻す。
  // これは防御ではなく案内（設計書 §6.1）── 防御は鍵が無ければ復号できないこと。
  //
  // hasKey() ではなく loadCodec() の結果で判断する。**この 2 つは一致しない。**
  // hasKey() が見るのは形（`salt.iter.key` の 3 つが揃っているか）だけで、
  // salt や key が base64 として壊れていても true を返す。その場合
  // loadCodec() は null を返すので、hasKey() で通してしまうと codec が null のまま
  // createSync へ流れ込み、最初に codec.encode / decode を呼んだところで
  // 「Cannot read properties of null」が無関係な場所から出る ──
  // 原因が壊れた tp:key であることは画面からもコンソールからも読み取れない。
  //
  // 壊れていた鍵素材はここで捨てる。残しておくと戻った先の index.html が
  // 「鍵は設定済み」と判断して合言葉の欄を出さず、入口が塞がったまま堂々巡りになる。
  const codec = hasKey(store) ? await loadCodec(store) : null;
  if (codec === null) {
    clearKey(store);
    location.replace("index.html");
    return;
  }

  const sync = createSync({ store, config: { ...DEFAULT_CONFIG, codec } });
```

`renderNav(...)` の直後、`await sync.load()` の**前**に `publishUI` の組み立てを移す（今は 341〜356 行目にある）。

```js
  renderNav(document.getElementById("nav"), "schedule");

  // 公開の導線は load() より前に組み立てる。
  // events.json の手編集は廃止したので（設計書 §6.5）、リモートが壊れたときの
  // 復旧手段は「正しい下書きを持つ端末から公開し直す」1 本しかない。
  // load() のあとに組むと、リモートが壊れている端末では公開ボタンも
  // トークン設定も DOM に現れず、直す手段がゼロになる（設計書 §13）。
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
    onAdopt: (data) => {
      setData(data);
      safeDraw("リモートの取り込み");
    },
  });

  let loaded;
  try {
    loaded = await sync.load();
  } catch (error) {
    if (error instanceof EventDataError) throw error;
    if (error?.name === "DecryptError") throw error;
    if (error?.cause instanceof SyntaxError) throw new DataParseError(error.message, error.cause);
    throw new DataFetchError(error?.message ?? String(error));
  }
  setData(loaded.data);

  if (loaded.outerStampMismatch) {
    // 封筒の外側は認証されないので、改竄も破損も GCM は気付かない。
    // 内側を正として表示しているが、黙って直すと誰も気付かないまま進む
    setNotice(
      "リモートのファイルの更新時刻が中身と食い違っています。" +
        "中身の時刻を正として表示しています。公開し直すと揃います。"
    );
  }
```

元の位置にあった `publishUI = createPublishUI({...})` のブロックを削除し、`publishUI.start(loaded.source)` は `draw()` の直前に残す。

**そのうえで `assets/js/publish-ui.js` のマウントを `start()` から出す。** これをしないと、上の並べ替えは何の効果も持たない（`createPublishUI()` は要素を組み立てるだけで DOM に挿入しない）。

`createPublishUI()` の本体の末尾で、**store しか読まない初期化**をすべて済ませる:

```js
  // ここまでで DOM への挿入を終える。**start() まで待たないこと。**
  // これらが読むのは store だけで（refreshDirty → sync.hasUnpublishedChanges() は
  // localStorage を見る、getData はクリックされるまで呼ばれない）、旅程データを
  // 必要としない。start() に残すと、load() が投げた端末では replaceChildren が
  // 一度も走らず、公開ボタンもトークン設定も DOM に現れない ──
  // events.json の手編集を廃止した以上、それは復旧手段がゼロになるということ。
  buildPanel();
  setPanelOpen(false);
  clearStatus();
  refreshDirty();
  renderControls();
```

`start(source)` に残すのは **`source` に依存する同期バーだけ**にする（`use-remote` / `remote-is-newer` / `offline` の案内）。`start()` から上の 5 行を削除すること。

`tests/publish-ui.test.js` に 1 件足す ── **`start()` を呼ばなくても公開の導線が DOM に入っていること**。これが今回の眼目を機械的に守る唯一のテストになる（`schedule.js` は `node --test` から import できないため）。

```js
test("start() を呼ぶ前に、公開の導線が DOM に入っている", () => {
  // load() が投げた端末でも復旧手段が残ることの機械的な保証。
  // createPublishUI が要素を組み立てるだけで挿入しないと、
  // リモートが壊れた端末には公開ボタンもトークン設定も現れない
  const els = makeEls();            // 既存のヘルパーに合わせて読み替えること
  const store = createStore(fakeBackend());
  writeToken(store, "ghp_test");

  createPublishUI({ els, store, sync: fakeSync(), getData: () => null, onAdopt: () => {} });

  assert.ok(els.controls.childNodes.length > 0, "start() 前に controls が空のまま");
});
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test`
Expected: PASS（`load-error.test.js` の 8 件を含む全件）

- [ ] **Step 5: ブラウザで起動順を確かめる**

```bash
python3 -m http.server 8000
```

`http://localhost:8000/schedule.html` を開き、DevTools のコンソールで確認する。

1. `localStorage.setItem("tp:key", "こわれた値")` → リロード → `index.html` へ飛ぶこと
   （形からして違う値。`hasKey()` が false になる経路）
2. `localStorage.setItem("tp:key", "!!!not-base64.600000.also-bad")` → リロード →
   **`index.html` へ飛び、かつ `tp:key` が消えていること**（`hasKey()` は true だが
   `loadCodec()` が null を返す経路。捨てないと入口が塞がったまま堂々巡りになる）
3. 鍵を正しく入れた状態で `localStorage.setItem("tp:events", '{"days":[]}')` → リロード → 旅程はエラーになるが、**公開ボタンとトークン設定の導線が画面に出ていること**（これが今回の眼目）

- [ ] **Step 6: commit**

```bash
git add assets/js/load-error.js assets/js/schedule.js tests/load-error.test.js
git commit -m "Build the publish UI before loading, so a broken remote stays fixable"
```

---

## Task 6: 合言葉の入力欄と、archive ページの撤去

**Files:**
- Modify: `index.html`, `assets/js/menu.js`, `assets/js/nav.js`, `assets/js/stub-page.js`
- Delete: `archive.html`
- Test: `tests/csp.test.js`, `tests/renderers.test.js`

**Interfaces:**
- Consumes: Task 3 の `hasKey` / `unlock` / `clearKey`、Task 2 の `isEnvelope`
- Produces: なし（ページの入口）

- [ ] **Step 1: 失敗するテストを書く**

`tests/csp.test.js:5` の `PAGES` を 3 つにする。

```js
// archive.html は取りやめた検索アーカイブの仮ページで、B4 で削除した（設計書 §2.1）
const PAGES = ["index.html", "schedule.html", "packing.html"];
```

`tests/renderers.test.js:337-344` の `renderNav: 3 ページ分のリンクとホームを出す` を差し替える。**リンク数の期待値 `3` を `2` に直すのを忘れないこと**（`href` の配列だけ直すと、数のほうが通らない）。

```js
test("renderNav: 2 ページ分のリンクとホームを出す", () => {
  const html = navHtml(null);
  for (const href of ["index.html", "schedule.html", "packing.html"]) {
    assert.ok(html.includes(`href="${href}"`), `${href} へのリンクがありません`);
  }
  // nav__links（囲みの div）に釣られないよう、直後の文字まで見る
  assert.equal(html.match(/class="nav__link[" ]/g).length, 2);
});

test("renderNav: 取りやめたデータ検索を出さない", () => {
  const html = navHtml(null);
  assert.ok(!html.includes("archive.html"));
  assert.ok(!html.includes("データ検索"));
});
```

`tests/csp.test.js` に 1 件足す。

```js
test("archive.html は残っていない", () => {
  assert.equal(existsSync(new URL("../archive.html", import.meta.url)), false);
});
```

`existsSync` を `node:fs` から import する（未 import なら足す）。

- [ ] **Step 2: 失敗することを確認する**

Run: `node --test tests/csp.test.js tests/renderers.test.js`
Expected: FAIL。`archive.html` が実在し、`renderNav` が「データ検索」を出している

- [ ] **Step 3: 実装する**

`archive.html` を削除する。

```bash
git rm archive.html
```

`assets/js/nav.js` の `PAGES` から archive の行を削除する。

```js
const PAGES = [
  { key: "schedule", href: "schedule.html", label: "旅程", ico: "i-calendar" },
  { key: "packing", href: "packing.html", label: "持ち物", ico: "i-luggage" },
];
```

`assets/js/stub-page.js` の冒頭コメントを `packing.html` 専用に直す（`archive.html` への言及を消す）。

`index.html` の `<main>` に合言葉の欄を足す。**インライン `<script>` も `on*` 属性も書かない**（CSP）。

```html
      <div class="menu__head reveal">
        <div>
          <p class="eyebrow">12–17 August 2026</p>
          <h1 class="display lines" style="margin-top: var(--s2)">
            <span class="ln"><i>Thailand</i></span>
          </h1>
        </div>
        <p class="micro" id="countdown"></p>
      </div>

      <form class="pubpanel reveal" id="auth-form" hidden>
        <label class="inp__label" for="auth-pass">合言葉</label>
        <input class="inp" type="password" id="auth-pass" autocomplete="current-password" />
        <p class="micro" id="auth-status" role="status"></p>
        <button class="btn" type="submit" id="auth-submit">開く</button>
      </form>

      <div class="menu__grid" id="menu"></div>
```

`assets/js/menu.js` を変更する。`CARDS` から archive の 1 枚を削除し、番号を振り直す。

```js
const CARDS = [
  {
    href: "schedule.html",
    num: "01",
    eyebrow: "Itinerary",
    title: "旅程",
    ico: "i-calendar",
    desc: "6日間のタイムライン、地図、各スポットの詳細とメモ。",
    image:
      "https://www.thailandtravel.or.jp/wp-content/uploads/2017/07/241531199_1074098326727081_2405869266411881148_nSNSre.jpg",
  },
  {
    href: "packing.html",
    num: "02",
    eyebrow: "Packing",
    title: "持ち物リスト",
    ico: "i-luggage",
    desc: "二人分のチェックリスト。アイテムごとにメモを残せます。",
    image:
      "https://www.thailandtravel.or.jp/wp-content/uploads/2017/03/01871-808x538.jpg",
  },
];
```

import と合言葉の配線を足す。

```js
import { createStore } from "./store.js";
import { hasKey, unlock, clearKey } from "./auth.js";
import { isEnvelope } from "./crypto.js";
import { DEFAULT_CONFIG } from "./sync.js";
```

```js
/**
 * 合言葉の欄。鍵を持っていれば出さない（毎回入れさせない）。
 *
 * 画面は合言葉を一切表示し直さない ── 入力欄は type="password"、
 * 送信後に必ず空にし、状態は「設定済み／未設定」だけを出す（設計書 §5.4 と同じ規約）。
 *
 * ソルトはリモートの封筒から取る。まだ平文なら kdf が無いので null を渡し、
 * unlock が新しいソルトを生成する（切り替え当日の 1 回だけ通る経路）。
 */
function buildAuthForm(store) {
  const form = need("auth-form");
  const input = need("auth-pass");
  const status = need("auth-status");
  const submit = need("auth-submit");

  if (hasKey(store)) {
    form.hidden = true;
    return;
  }
  form.hidden = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const passphrase = input.value;
    if (!passphrase) {
      status.textContent = "合言葉を入力してください。";
      return;
    }

    submit.disabled = true;
    status.textContent = "鍵を作っています（数秒かかります）…";
    try {
      let body = null;
      try {
        const response = await fetch(DEFAULT_CONFIG.path, { cache: "no-store" });
        body = await response.json();
      } catch (error) {
        // 取れなくても止めない。新しいソルトで鍵を作り、次の公開で確定させる
        console.warn("menu: 既存のソルトを取得できませんでした", error);
      }

      const encrypted = isEnvelope(body);
      const codec = await unlock(store, passphrase, encrypted ? body.kdf : null);

      // 合言葉が正しいかは、ここで実際に復号して確かめる。**この確認を省かないこと。**
      //
      // ソルトは 3 つの JSON で共有する（設計書 §6.3）ので、合言葉を打ち間違えても
      // 封筒の kdf は一致する。確かめずに鍵を保存すると、間違った鍵を持ったまま
      // schedule.html へ進み、そこでは kdf が一致するために GCM の失敗が
      // 「データが壊れています」と表示される ── 実際は打ち間違いなのに、
      // 画面は直し方の違うことを言う。crypto.js の kdf 比較が捕まえられるのは
      // 「別のソルトで暗号化されている」場合だけで、いちばん起きやすい
      // 打ち間違いはここでしか捕まえられない（設計書 §9）。
      if (encrypted) {
        try {
          await codec.decode(body);
        } catch (error) {
          clearKey(store);
          status.textContent = "合言葉が違います。";
          return;
        }
      }

      form.hidden = true;
      status.textContent = "";
      location.reload();
    } catch (error) {
      console.error(error);
      clearKey(store);
      status.textContent = "鍵を作れませんでした。もう一度お試しください。";
    } finally {
      // 合言葉を DOM に残さない
      input.value = "";
      submit.disabled = false;
    }
  });
}
```

`main()` に 1 行足す。

```js
function main() {
  injectSprite();
  renderNav(need("nav"), null);
  buildAuthForm(createStore());
  need("menu").innerHTML = CARDS.map(cardHtml).join("");
  need("countdown").innerHTML = countdownHtml(DEPARTURE, SUBTITLE);
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test`
Expected: PASS（全件）

- [ ] **Step 5: ブラウザで確かめる**

`http://localhost:8000/` を開く。

1. 鍵が無い状態で合言葉の欄が出ること。入れると欄が消え、リロード後も出ないこと
2. **入力欄が `type="password"` で、送信後に空になること**
3. **`events.json` が封筒のとき、わざと違う合言葉を入れると「合言葉が違います。」と出て、鍵が保存されないこと**（`localStorage.getItem("tp:key")` が `null` のまま）。この確認だけは Task 8 の切り替え後にしか実地でできないので、ここでは `assets/data/events.json` を一時的に封筒で置き換えて試し、**確認後に必ず戻すこと**
3. DevTools の Elements で `auth-form` の中に合言葉が残っていないこと
4. ナビに「データ検索」が無いこと、カードが 2 枚であること
5. `archive.html` を直接開くと 404 になること

- [ ] **Step 6: commit**

```bash
git add -A
git commit -m "Add the passphrase form and drop the cancelled archive page"
```

---

## Task 7: ドキュメントを実態に合わせる

**Files:**
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: Task 1〜6 の成果
- Produces: なし

コードを変えないので、このタスクだけ TDD の形を取らない。**Task 6 まで終わってから書くこと** ── 途中で書くと、実装が動いた結果と食い違う。

- [ ] **Step 1: `CLAUDE.md` を直す**

- ファイル構成に `crypto.js` / `auth.js` / `load-error.js` を足し、`archive.html` の行を削除する
- 「新しいイベントを追加」の節から**手編集の手順を削除**し、「画面から追加する」だけを残す。`events.json` は暗号文なのでテキストエディタで開けないことを書く
- `localStorage` のキーの表に `tp:key`（`auth.js` が唯一の出入口）を足す
- 「保存と公開」の節に、読み込みは fetch → 復号 → 検証、公開は 検証 → 暗号化 → PUT の順であることを書く
- **合言葉を忘れると復旧できない**こと、控えをパスワードマネージャに残すことを書く
- テストの一覧に `crypto.test.js` / `auth.test.js` / `load-error.test.js` を足す
- CSP の節の「4 ページ」を 3 ページに直す

- [ ] **Step 2: 設計書 §13 に、B4 で見つけた残存する穴を書き足す**

`docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md` の §13
「Phase B1 からの繰り越し（保存と公開）」に次を足す。Task 5 のレビューが見つけたもので、
**B4 の範囲では直さないと決めた**（直すには 409 の判断そのものを設計し直す必要がある）。

> - **壊れたリモートを「下書きを持つ端末から公開して直す」経路が、409 で塞がることがある。**
>   B4 で `publish-ui` を `load()` より前に組み、`sync.readDraft()` で下書きを
>   `state` に載せるようにしたので、リモートの `days` / `events` が壊れていても
>   公開ボタンは出て押せる。ただし**壊れたリモートが「JSON としては読めて
>   `updatedAt` が `tp:events-base` より新しい」形**だと、`assertRemoteNotAhead()` が
>   PUT の前に 409 で止める。409 の画面が示す唯一の逃げ道（「取り込む」→
>   `adoptRemote()`）も `validate` で落ちるので、その端末では直せない。
>   `events.json` の手編集は廃止したので、この場合の復旧はリポジトリへの
>   git コミットに戻る。直すなら「リモートが検証を通らないと分かっている回に限り
>   突き合わせを飛ばす」を sync 層に入れることになる

- [ ] **Step 3: `README.md` を直す**

- ファイル構成から `archive.html` を削除
- 現在実装済みの説明に、合言葉が要ることを足す

- [ ] **Step 4: 記述と実態が合っているか確かめる**

```bash
grep -rn "archive" CLAUDE.md README.md
node --test
```

Expected: `archive` の残存が 0 件（取りやめの経緯を説明している箇所を除く）。テストは全件 pass

- [ ] **Step 5: commit**

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md
git commit -m "Drop the hand-editing procedure now that the itinerary is encrypted"
```

---

## Task 8: 本番を暗号文へ切り替え、開通を確認する

**Files:** なし（運用作業）

**Interfaces:**
- Consumes: Task 1〜7
- Produces: 暗号文になった `assets/data/events.json`

**このタスクは取り消せない。** 押した瞬間から、鍵の無い端末は旅程を見られなくなる。出発が 2026-08-12 なので、**切り替えと開通確認は同じ日に済ませること**（設計書 §10）。

- [ ] **Step 1: 合言葉を決め、控えを残す**

同行者に口頭やスクリーンショットで伝えられる長さにする。**パスワードマネージャに控える** ── 忘れると git 履歴からも復旧できない（履歴に残るのも暗号文）。

- [ ] **Step 2: PBKDF2 の所要時間を実機で測る**

実機のブラウザで `index.html` を開き、合言葉を入れて「開く」を押してから欄が消えるまでを測る。

**3 秒を大きく超えるなら、ここで `assets/js/crypto.js` の `ITERATIONS` を下げ、設計書 §6.2 の値も一緒に直す。** 切り替えたあとに変えると、全端末で鍵を作り直すことになる。

- [ ] **Step 3: 現在の平文を控える**

```bash
git rev-parse HEAD
cp assets/data/events.json /tmp/events-plaintext-backup.json
```

切り替えのコミットの 1 つ前を控えておけば、暗号化前の内容は git 履歴から復元できる。**この控えはリポジトリに入れないこと。**

- [ ] **Step 4: 切り替える**

1. `main` を push し、GitHub Pages のビルド完了を待つ
2. 本番の `index.html` を開き、合言葉を入れる
3. `schedule.html` を開き、旅程が見えることを確認する（この時点ではまだ平文を読んでいる）
4. **「公開」を押す。** これで `events.json` が封筒になる

- [ ] **Step 5: 切り替わったことを確かめる**

```bash
curl -s https://y-shinozaki.github.io/travel-plans/assets/data/events.json | head -c 400
```

Expected: `ct` / `iv` / `kdf` を持つ封筒 JSON が返り、日本語の地名が 1 つも見えないこと。`updatedAt` は平文で見えていてよい（設計書 §6.2）。

- [ ] **Step 6: 5 名＋恵美さんの端末で開通確認をする**

**一人ずつ、実端末で**（iPhone Safari / Android Chrome）。

1. `https://y-shinozaki.github.io/travel-plans/` を開く
2. 合言葉を入れる
3. 旅程が見えることを確認する
4. タブを閉じて開き直し、**再入力を求められない**ことを確認する（鍵が `localStorage` に残っている）

一人でも開けなければ、その場で原因を切り分ける。`classifyLoadError` の文言（「別の合言葉で暗号化されています」／「中身が壊れています」）がそのまま切り分けになる。

- [ ] **Step 7: 実データのテストを更新する**

`tests/data.test.js` は**モジュール冒頭（`:20-22`）で `assets/data/events.json` を読んで `data` に入れ、以降の全テストがそれを使う**。封筒になると `JSON.parse` は通るが `validateEvents(data)` が投げ、**このファイルのテストが全滅する**。

このテストの価値は「関数は正しいがデータが壊れた、という編集事故を検知する」ことにあった（ファイル冒頭のコメント）。暗号化するとリポジトリ側からは中身を確かめられないので、**役割を 2 つに割る**。

1. **リポジトリのファイルが封筒の形をしていることを検査する**（新しい役割）

```js
import { isEnvelope } from "../assets/js/crypto.js";

test("公開されている events.json は封筒になっている", () => {
  const raw = JSON.parse(readFileSync(new URL("../assets/data/events.json", import.meta.url), "utf8"));
  assert.equal(isEnvelope(raw), true);
  assert.equal(typeof raw.updatedAt, "string");   // 突き合わせ用の外側は残っている
  assert.equal(typeof raw.kdf.salt, "string");
  assert.equal(typeof raw.kdf.iter, "number");
});

test("封筒に旅程の中身が漏れていない", () => {
  const text = readFileSync(new URL("../assets/data/events.json", import.meta.url), "utf8");
  for (const word of ["スワンナプーム", "パタヤ", "ホテル", "cat-move"]) {
    assert.ok(!text.includes(word), `${word} が暗号文の外に出ています`);
  }
});
```

2. **パイプラインの検査は、実データではなくフィクスチャで残す。** モジュール冒頭の `data` を、`tests/` に置いた固定のフィクスチャ（旅程の形をした 3〜4 件の合成データ）へ差し替え、件数・セグメント数・地点数の期待値をそのフィクスチャから取れる値に直す。

**「編集事故の検知」という元の役割はここで失われる。** 実データを機械的に検査できるのは公開前の `validateEvents`（`sync.js` の `publish()`）だけになる。**これは暗号化と引き換えに受け入れる損失なので、`tests/data.test.js` の冒頭コメントを書き換えて明記し、設計書 §13 の「テストの穴」にも 1 行足すこと** ── 黙って消すと、次の人はこのファイルが実データを見ていると思い込む。

Run: `node --test`
Expected: PASS（全件）

- [ ] **Step 8: commit**

```bash
git add tests/data.test.js
git commit -m "Check the published itinerary is an envelope, not a plaintext count"
git push
```

---

## Self-Review

**1. Spec coverage**

| 設計書 | 対応する Task |
|---|---|
| §4 下書きは平文のまま | Task 4（`storeAdopted(stamped)` が平文を書く） |
| §5.1 注入口 5 つを同時に | Task 4 |
| §5.2 fetch → 復号 → 検証、起動順の変更 | Task 4, 5 |
| §5.3 検証 → 暗号化 → GET → 突き合わせ → PUT → base | Task 4 |
| §6.1 合言葉の役割・忘れると復旧不可 | Task 7, 8 |
| §6.2 封筒 JSON、IV の引き直し、内外の `updatedAt` | Task 2 |
| §6.3 鍵の一生、`localStorage`、ソルト共有 | Task 3 |
| §6.5 平文からの移行、手編集の廃止、復旧手段が 1 本 | Task 5, 7, 8 |
| §7.1 合言葉の欄、カード 2 枚 | Task 6 |
| §9 復号系の見分け 4 通り | Task 5（`classifyLoadError`）。「鍵が無い」は Task 5 の `hasKey` ガード |
| §10 PBKDF2 の実測、開通確認 | Task 8 |
| §13 `createSync` の 3 点＋codec | Task 4 |
| §13 `publish-ui` を `load()` より前に | Task 5 |
| §13 `fromBase64Utf8` の型ガード | Task 1 |
| §2.1 `archive.html` の削除と波及 | Task 6 |

**2. Placeholder scan** — 「TBD」「後で」「適切に」「上記のテストを書く」は含まれていない。全コードステップに実際のコードがある。

**3. Type consistency**

- `decode` は全経路で `{data, outerStampMismatch}` を返す（Task 2 の `createCodec` と `passthroughCodec`、Task 4 の `fetchAndDecode`）
- `DecryptError.reason` は `"wrong-key" | "corrupt" | "malformed"`。Task 5 の `classifyLoadError` は 3 つすべてを扱い、`corrupt` と `malformed` を同じ `kind: "corrupt"` に畳む（利用者から見た直し方が同じため）
- `kdf` の形は `{salt: string, iter: number}` で統一（Task 2 の封筒、Task 3 の `kdfMatches` / `unlock`、Task 6 の `buildAuthForm`）
- `readKeyMaterial` の戻り値は `{salt, iter, key}`（すべて `iter`。`iterations` は `createCodec` の引数名で、こちらは別物）

**4. 積み残し（意図的）**

- `packing.json` / `comments.json` の暗号化は B2 / B3。土台（5 点注入と codec）だけを用意した
- §13 の他の繰り越し（`validateEvent` の戻り値の形、`imagePos` の検証、地図の署名分割、シートの `canClose`）は B2 の担当
