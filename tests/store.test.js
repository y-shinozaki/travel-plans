import test from "node:test";
import assert from "node:assert/strict";
import { createStore, StoreWriteError } from "../assets/js/store.js";

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
  const original = console.warn;
  console.warn = () => {}; // 警告を捨てる
  try {
    const store = createStore(memoryBackend({ "tp:events": "{ぐちゃぐちゃ" }));
    assert.equal(store.read("events", "既定値"), "既定値");
  } finally {
    console.warn = original;
  }
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
  const original = new Error("quota");
  original.name = "QuotaExceededError";
  backend.setItem = () => { throw original; };

  assert.throws(
    () => createStore(backend).write("events", { a: 1 }),
    (error) =>
      error instanceof StoreWriteError &&
      error.cause === original &&
      /tp:events/.test(error.message)
  );
});

test("localStorage が使えない環境でも生成自体は成功する", () => {
  // プライベートブラウジングなどで getItem が throw することがある
  const original = console.warn;
  console.warn = () => {}; // 警告を捨てる
  try {
    const hostile = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => {},
    };
    const store = createStore(hostile);
    assert.equal(store.read("a", "既定値"), "既定値");
    assert.equal(store.has("a"), false);
  } finally {
    console.warn = original;
  }
});

test("readText / writeText は JSON を通さず生の文字列を扱う", () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  store.writeText("gh-token", "ghp_secret");
  // 引用符が付かない ＝ JSON.parse を通していない
  assert.equal(backend._dump()["tp:gh-token"], "ghp_secret");
  assert.equal(store.readText("gh-token"), "ghp_secret");
  assert.equal(store.has("gh-token"), true);
});

test("readText は未設定なら null を返す", () => {
  assert.equal(createStore(memoryBackend()).readText("nope"), null);
});

test("readText は JSON として壊れた値でも中身を console に出さない", () => {
  // read は SyntaxError の文言に中身の先頭を載せてしまう。
  // 秘密を扱う側（token.js）はそれを避けるために readText を使う
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(" "));
  try {
    const store = createStore(memoryBackend({ "tp:secret": "ghp_liveSecretValue" }));
    assert.equal(store.readText("secret"), "ghp_liveSecretValue");
  } finally {
    console.warn = original;
  }
  assert.deepEqual(seen, []);
});

test("writeText の失敗も StoreWriteError で知らせ、値は文言に載せない", () => {
  const backend = memoryBackend();
  backend.setItem = () => {
    throw new Error("quota");
  };
  assert.throws(
    () => createStore(backend).writeText("gh-token", "ghp_liveSecretValue"),
    (error) =>
      error instanceof StoreWriteError &&
      /tp:gh-token/.test(error.message) &&
      !error.message.includes("ghp_liveSecretValue")
  );
});

test("remove が例外を投げても外に出さない", () => {
  // removeItem が投げるバックエンドでも remove は静かに失敗する
  const original = console.warn;
  console.warn = () => {}; // 警告を捨てる
  try {
    const backend = memoryBackend();
    backend.removeItem = () => { throw new Error("cannot remove"); };
    // remove が例外を投げずに返ることを確認
    assert.doesNotThrow(() => createStore(backend).remove("x"));
  } finally {
    console.warn = original;
  }
});
