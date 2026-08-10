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
