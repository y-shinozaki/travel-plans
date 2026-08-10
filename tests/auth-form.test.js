/**
 * 合言葉の入力欄（auth-form.js）。
 *
 * ここで押さえるのは「決定の核心」── レビューで見つかった 2 つの Important の
 * 再発防止:
 *
 * 1. 鍵が「形は正しいが中身（合言葉）が間違っている」まま保存されても、
 *    入れ直す場所が常にあること
 * 2. 合言葉の検証（decode() を実際に呼ぶ）が省かれていないこと
 *
 * DOM スタブと fetch/store の組み立て方は publish-ui.test.js / sync.test.js と
 * 同じ流儀にしてある（makeNode・fakeFetch・memoryBackend）。ヘルパーの意味が
 * 変わるとテストの読み方が食い違うので、そちらに揃える。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createAuthForm, MESSAGES } from "../assets/js/auth-form.js";
import { createStore } from "../assets/js/store.js";
import { hasKey, unlock } from "../assets/js/auth.js";
import { deriveKey, createCodec, SALT_BYTES } from "../assets/js/crypto.js";
import { toBase64Bytes } from "../assets/js/base64.js";

/* ── 最小の DOM（publish-ui.test.js と同じ形） ──────────── */

function makeNode(tag = "div") {
  const node = {
    tag,
    className: "",
    id: "",
    type: "",
    value: "",
    innerHTML: "",
    textContent: "",
    hidden: false,
    disabled: false,
    listeners: {},
    children: [],
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    replaceChildren(...kids) {
      node.children = [...kids];
    },
    addEventListener(type, fn) {
      (node.listeners[type] ??= []).push(fn);
    },
  };
  return node;
}

globalThis.document = { createElement: (tag) => makeNode(tag) };

const textOf = (node) => node.textContent + node.children.map(textOf).join("");
function walk(node, out = []) {
  out.push(node);
  for (const child of node.children) walk(child, out);
  return out;
}
const buttonsIn = (node) => walk(node).filter((n) => n.tag === "button");
const findButton = (node, label) => buttonsIn(node).find((b) => textOf(b).includes(label)) ?? null;

function fire(node, type = "click") {
  assert.ok(node, "存在しない要素をクリックしようとしています");
  for (const fn of node.listeners[type] ?? []) fn();
}

/** submit イベントの最小スタブ。auth-form.js が呼ぶのは preventDefault だけ。 */
function submit(form) {
  for (const fn of form.listeners.submit ?? []) fn({ preventDefault() {} });
}

/**
 * submit ハンドラ（async）が終わるのを待つ。
 *
 * PBKDF2 / AES-GCM は Node では実際にスレッドプールへ回るため、固定の
 * setTimeout では待ちきれないことがある ── 特に平文（移行当日）の経路は
 * kdf が無く、既定の 600,000 回（本番と同じ設定）で導出するため、1,000 回を
 * 使う他のテストより 1〜2 桁遅い。固定時間ではなく「submit が無効化されたあと
 * 元に戻るまで」を待つ（auth-form.js の finally が必ず戻すので、これが
 * ハンドラの完了を示す確実な合図になる）。
 *
 * 空欄送信のように disabled を一度も true にしない早期 return もあるため、
 * 「true になるのを待つ」のではなく「false である（に戻る）」ことをポーリングする。
 */
async function waitForSubmitDone(h, { timeout = 8000, interval = 5 } = {}) {
  const start = Date.now();
  while (h.els.submit.disabled) {
    if (Date.now() - start > timeout) {
      throw new Error("waitForSubmitDone: submit が無効化されたまま時間切れになりました");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * 「送信中は無効化されている」ことそのものを確かめるテストだけで使う短い待ち。
 * waitForSubmitDone は「無効化が解ける」のを待つので、無効化されていることの
 * 確認には使えない（解けるまで戻ってこない）。
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/* ── console（トークンのテストと同じくログを捕まえて検査する） ── */

const LOGS = [];
for (const key of ["warn", "error", "log", "info"]) {
  console[key] = (...args) => LOGS.push(args.map((a) => String(a?.message ?? a)).join(" "));
}
test.beforeEach(() => {
  LOGS.length = 0;
});

/* ── store / fetch（sync.test.js と同じ組み立て） ─────────── */

function memoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length - 1);
  };
  impl.calls = calls;
  return impl;
}

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const PATH = "assets/data/events.json";
const PASSPHRASE = "たいへんひみつのパスフレーズ";

/** 低い iterations で組み立てる。600,000 回はテストには重すぎる。 */
async function envelopeFor(passphrase, data, { salt = new Uint8Array(SALT_BYTES).fill(3), iterations = 1000 } = {}) {
  const key = await deriveKey(passphrase, salt, iterations);
  const codec = createCodec({ key, salt, iterations });
  return codec.encode(data);
}

const PLAIN_DATA = { updatedAt: "2026-08-10T00:00:00.000Z", days: ["8/12"], events: [] };

function mount({ store, fetchImpl, path = PATH, reload = () => {} } = {}) {
  const els = {
    state: makeNode("p"),
    actions: makeNode("div"),
    form: makeNode("form"),
    input: makeNode("input"),
    status: makeNode("p"),
    submit: makeNode("button"),
  };
  const reloadCalls = [];
  const ui = createAuthForm({
    els,
    store,
    path,
    fetchImpl,
    reload: () => {
      reloadCalls.push(1);
      reload();
    },
  });
  return { ui, els, reloadCalls, dom: () => [els.state, els.actions, els.form].map(textOf).join(" ") };
}

/* ══════════════════════════════════════════════════════════
   合言葉の検証（decode() の確かめ）
   ══════════════════════════════════════════════════════════ */

test("違う合言葉なら鍵を保存せず、合言葉が違う旨を出す", async () => {
  const store = createStore(memoryBackend());
  const envelope = await envelopeFor(PASSPHRASE, PLAIN_DATA);
  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, envelope)) });

  h.els.input.value = "うっかり打ち間違えたパスフレーズ";
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(hasKey(store), false, "間違った合言葉でも鍵が残っています");
  assert.equal(textOf(h.els.status), MESSAGES.wrongPassphrase);
  assert.equal(h.reloadCalls.length, 0, "失敗したのに reload しています");
});

test("正しい合言葉なら鍵が保存され、入力欄を閉じて reload する", async () => {
  const store = createStore(memoryBackend());
  const envelope = await envelopeFor(PASSPHRASE, PLAIN_DATA);
  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, envelope)) });

  h.els.input.value = PASSPHRASE;
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(hasKey(store), true);
  assert.equal(h.els.form.hidden, true);
  assert.equal(h.reloadCalls.length, 1);
});

test("平文（ct 無し）なら新しいソルトで鍵を作る（移行当日の経路）", async () => {
  const store = createStore(memoryBackend());
  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, PLAIN_DATA)) });

  h.els.input.value = PASSPHRASE;
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(hasKey(store), true);
  assert.equal(h.els.form.hidden, true);
});

test("reason が malformed なら「合言葉が違います」ではなく壊れている旨を出す", async () => {
  // kdf は一致させたまま ct を base64 として壊す。crypto.js の decode() は
  // ここを reason: "malformed" で弾く ── 合言葉の問題ではないので、
  // 「合言葉が違います」を出すと直しようのないものを直させ続けることになる
  const store = createStore(memoryBackend());
  const envelope = await envelopeFor(PASSPHRASE, PLAIN_DATA);
  const broken = { ...envelope, ct: "@@@not-base64@@@" };
  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, broken)) });

  h.els.input.value = PASSPHRASE;
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(hasKey(store), false);
  assert.equal(textOf(h.els.status), MESSAGES.corruptData);
  assert.notEqual(textOf(h.els.status), MESSAGES.wrongPassphrase);
});

/* ══════════════════════════════════════════════════════════
   fetch 失敗（Important 1(b)(c)）
   ══════════════════════════════════════════════════════════ */

test("fetch が失敗したら鍵を保存しない", async () => {
  const store = createStore(memoryBackend());
  const h = mount({
    store,
    fetchImpl: fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    }),
  });

  h.els.input.value = PASSPHRASE;
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(hasKey(store), false, "通信断なのに鍵ができています");
  assert.equal(textOf(h.els.status), MESSAGES.fetchFailed);
  assert.equal(h.els.form.hidden, false, "失敗したのに入力欄を閉じています");
});

test("response.ok が false（404 など）なら本文を読まずに止める", async () => {
  // GitHub Pages の 404 は HTML を返す。.json() が例外になっても助かるが、
  // ここでは response.ok を見て、パース前に止まることを確かめる
  const store = createStore(memoryBackend());
  const h = mount({
    store,
    fetchImpl: fakeFetch(() => new Response("<html>not found</html>", { status: 404 })),
  });

  h.els.input.value = PASSPHRASE;
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(hasKey(store), false);
  assert.equal(textOf(h.els.status), MESSAGES.fetchFailed);
});

test("2xx でも JSON として読めない本文なら鍵を保存しない", async () => {
  const store = createStore(memoryBackend());
  const h = mount({
    store,
    fetchImpl: fakeFetch(() => new Response("これは JSON ではない", { status: 200 })),
  });

  h.els.input.value = PASSPHRASE;
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(hasKey(store), false);
  assert.equal(textOf(h.els.status), MESSAGES.fetchFailed);
});

/* ══════════════════════════════════════════════════════════
   合言葉が DOM にも store にも例外文にも残らない
   ══════════════════════════════════════════════════════════ */

test("合言葉は DOM にも store にも console にも残らない", async () => {
  const store = createStore(memoryBackend());
  const envelope = await envelopeFor(PASSPHRASE, PLAIN_DATA);
  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, envelope)) });

  h.els.input.value = PASSPHRASE;
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(h.els.input.value, "", "入力欄に合言葉が残っています");
  assert.equal(h.dom().includes(PASSPHRASE), false, "DOM に合言葉が出ています");
  const raw = store.readText("key");
  assert.equal(raw?.includes(PASSPHRASE) ?? false, false, "store に合言葉が残っています");
  assert.equal(LOGS.join("\n").includes(PASSPHRASE), false, "console に合言葉が出ています");
});

test("間違えたときも合言葉は残らない", async () => {
  const store = createStore(memoryBackend());
  const envelope = await envelopeFor(PASSPHRASE, PLAIN_DATA);
  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, envelope)) });

  h.els.input.value = "うっかり打ち間違えたパスフレーズ";
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(h.els.input.value, "");
  assert.equal(h.dom().includes("うっかり打ち間違えたパスフレーズ"), false);
  assert.equal(LOGS.join("\n").includes("うっかり打ち間違えたパスフレーズ"), false);
});

/* ══════════════════════════════════════════════════════════
   入れ直す導線（Important 1(a)）
   ══════════════════════════════════════════════════════════ */

test("鍵があれば常に「入れ直す」ボタンが出る。hasKey に関わらず入力欄への道が残る", async () => {
  const store = createStore(memoryBackend());
  // 形は正しいが中身（合言葉）は分からない鍵。unlock で適当に作る
  await unlock(store, "何らかの合言葉", { salt: toBase64Bytes(new Uint8Array(SALT_BYTES)), iter: 1000 });
  assert.equal(hasKey(store), true, "前提: 鍵がある");

  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, PLAIN_DATA)) });

  assert.equal(textOf(h.els.state), MESSAGES.stateSet);
  assert.equal(h.els.form.hidden, true, "鍵がある間は入力欄を開いたままにしない");
  const reenter = findButton(h.els.actions, MESSAGES.reenter);
  assert.ok(reenter, "入れ直すボタんがありません");
});

test("「入れ直す」は 1 度目で身構え、2 度目で鍵を消して入力欄を開く", async () => {
  const store = createStore(memoryBackend());
  await unlock(store, "何らかの合言葉", { salt: toBase64Bytes(new Uint8Array(SALT_BYTES)), iter: 1000 });
  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, PLAIN_DATA)) });

  const reenter = findButton(h.els.actions, MESSAGES.reenter);
  fire(reenter);
  assert.equal(hasKey(store), true, "1 度目で消えています");
  assert.equal(textOf(reenter).includes(MESSAGES.reenterArmed) || textOf(reenter).includes("もう一度"), true);
  assert.equal(h.els.form.hidden, true, "1 度目で入力欄が開いています");

  fire(reenter);
  assert.equal(hasKey(store), false, "2 度目で鍵が消えていません");
  assert.equal(h.els.form.hidden, false, "2 度目で入力欄が開いていません");
});

test("鍵が無ければ状態は「未設定」で、入れ直すボタンは出さない", () => {
  const store = createStore(memoryBackend());
  const h = mount({ store, fetchImpl: fakeFetch(() => jsonResponse(200, PLAIN_DATA)) });

  assert.equal(textOf(h.els.state), MESSAGES.stateUnset);
  assert.equal(findButton(h.els.actions, MESSAGES.reenter), null);
  assert.equal(h.els.form.hidden, false, "鍵が無いのに入力欄が閉じています");
});

/* ══════════════════════════════════════════════════════════
   その他
   ══════════════════════════════════════════════════════════ */

test("空のまま送信すると入力を促し、通信しない", async () => {
  const store = createStore(memoryBackend());
  const fetchImpl = fakeFetch(() => jsonResponse(200, PLAIN_DATA));
  const h = mount({ store, fetchImpl });

  h.els.input.value = "";
  submit(h.els.form);
  await waitForSubmitDone(h);

  assert.equal(fetchImpl.calls.length, 0, "空欄なのに通信しています");
  assert.equal(textOf(h.els.status), MESSAGES.needPassphrase);
});

test("送信中は submit を無効化し、終わったら戻す", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const store = createStore(memoryBackend());
  const envelope = await envelopeFor(PASSPHRASE, PLAIN_DATA);
  const h = mount({
    store,
    fetchImpl: fakeFetch(async () => {
      await gate;
      return jsonResponse(200, envelope);
    }),
  });

  h.els.input.value = PASSPHRASE;
  submit(h.els.form);
  await settle();
  assert.equal(h.els.submit.disabled, true, "送信中に submit が有効なままです");

  release();
  await waitForSubmitDone(h);
  assert.equal(h.els.submit.disabled, false);
});
