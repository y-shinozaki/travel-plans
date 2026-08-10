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
