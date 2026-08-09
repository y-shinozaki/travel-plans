import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createSync, DEFAULT_CONFIG } from "../assets/js/sync.js";
import { readToken, writeToken, clearToken, hasToken } from "../assets/js/token.js";
import { createStore } from "../assets/js/store.js";
import { EventDataError } from "../assets/js/validate.js";
import { GitHubError } from "../assets/js/github.js";
import { toBase64Utf8, fromBase64Utf8 } from "../assets/js/base64.js";

/**
 * store は memoryBackend を差した本物の createStore を使う。
 * 偽の store を作ると tp: の名前空間やキー名の取り違えを見逃すため。
 */
function memoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

/** 呼ばれた回数と中身を残す fetch。呼ばれなかったことも検査したいので calls を持たせる。 */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init, method: init?.method ?? "GET" });
    return handler(String(url), init, calls.length - 1);
  };
  impl.calls = calls;
  return impl;
}

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** 既定値をハードコードしていないことを示すため、テストは本物と違う config を渡す。 */
const CONFIG = { owner: "acme", repo: "trip", branch: "dev", path: "data/plan.json" };
const CONTENTS_URL = "https://api.github.com/repos/acme/trip/contents/data/plan.json";

const FIXED_MS = Date.parse("2026-08-09T12:00:00.000Z");
const FIXED_ISO = "2026-08-09T12:00:00.000Z";
const now = () => FIXED_MS;

const DAYS = [
  { date: "8/12", dow: "水" },
  { date: "8/13", dow: "木" },
];

const ev = (over = {}) => ({
  id: "ev-1",
  cat: "cat-food",
  title: "昼食",
  startDay: 0,
  endDay: 0,
  start: 12,
  end: 13,
  ...over,
});

const plan = (updatedAt, events = [ev()]) => ({ updatedAt, days: DAYS, events });

/** days が空なので validateEvents に必ず弾かれる。 */
const BROKEN = { updatedAt: "2026-08-09T09:00:00.000Z", days: [], events: [] };

const DRAFT_KEY = "tp:events";
const BASE_KEY = "tp:events-base";

/** store と sync を一組で用意する。initial は tp: 付きの生キーで渡す。 */
function setup({ initial = {}, handler = () => jsonResponse(500, {}) } = {}) {
  const backend = memoryBackend(initial);
  const store = createStore(backend);
  const fetchImpl = fakeFetch(handler);
  const sync = createSync({ store, fetchImpl, config: CONFIG, now });
  return { backend, store, fetchImpl, sync, raw: (k) => backend._dump()[k] };
}

/**
 * console への出力を集める。トークンの漏れ検査とノイズ抑止の両方に使う。
 * 非同期の最中の出力も拾いたいので、fn の完了まで差し替えたままにする。
 */
async function captureConsole(fn) {
  const seen = [];
  const originals = {
    warn: console.warn,
    error: console.error,
    log: console.log,
    info: console.info,
  };
  for (const key of Object.keys(originals)) {
    console[key] = (...args) => seen.push(args.map((a) => String(a?.message ?? a)).join(" "));
  }
  try {
    return { result: await fn(), seen };
  } finally {
    Object.assign(console, originals);
  }
}

// ---------------------------------------------------------------- token.js

test("writeToken は tp:gh-token に保存し、readToken で読み戻せる", () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  writeToken(store, "ghp_secret");
  assert.deepEqual(Object.keys(backend._dump()), ["tp:gh-token"]);
  assert.equal(readToken(store), "ghp_secret");
});

test("hasToken はトークンの有無を返し、clearToken で消える", () => {
  const store = createStore(memoryBackend());
  assert.equal(hasToken(store), false);
  writeToken(store, "ghp_secret");
  assert.equal(hasToken(store), true);
  clearToken(store);
  assert.equal(hasToken(store), false);
  assert.equal(readToken(store), null);
});

test("貼り付けの前後の空白は落とす", () => {
  // 末尾の改行がそのまま Authorization ヘッダに入ると fetch が投げる
  const store = createStore(memoryBackend());
  writeToken(store, "  ghp_secret\n");
  assert.equal(readToken(store), "ghp_secret");
});

test("空文字は保存しない（使えないトークンを「設定済み」に見せない）", () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  writeToken(store, "ghp_secret");
  writeToken(store, "   ");
  assert.equal(hasToken(store), false);
  assert.equal(readToken(store), null);
  assert.deepEqual(Object.keys(backend._dump()), []);
});

test("文字列でない値が入っていてもトークン扱いしない", () => {
  const store = createStore(memoryBackend({ "tp:gh-token": "123" }));
  assert.equal(readToken(store), null);
  assert.equal(hasToken(store), false);
});

// ------------------------------------------------------------ sync: 既定値

test("DEFAULT_CONFIG は実在するファイルを指す", () => {
  assert.equal(DEFAULT_CONFIG.path, "assets/data/events.json");
  assert.equal(existsSync(DEFAULT_CONFIG.path), true);
  assert.equal(DEFAULT_CONFIG.owner, "y-shinozaki");
  assert.equal(DEFAULT_CONFIG.repo, "travel-plans");
  assert.equal(DEFAULT_CONFIG.branch, "main");
});

// -------------------------------------------------------------- sync: load

test("load() はリモートを検証してから返す", async () => {
  const remote = plan("2026-08-09T10:00:00.000Z");
  const { sync, fetchImpl, raw } = setup({ handler: () => jsonResponse(200, remote) });

  const out = await sync.load();

  assert.deepEqual(out.data, remote);
  assert.equal(out.source, "use-remote");
  assert.equal(out.remoteUpdatedAt, "2026-08-09T10:00:00.000Z");
  // config.path をそのまま読みに行く（GitHub API ではない ＝ トークン不要）
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, "data/plan.json");
  assert.equal(fetchImpl.calls[0].init.cache, "no-store");
  // 静かに取り込む。base を置かないと次回に偽の衝突が出る
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), remote);
  assert.equal(JSON.parse(raw(BASE_KEY)), "2026-08-09T10:00:00.000Z");
});

test("壊れたリモートは例外にし、下書きを書き換えない", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z");
  const { sync, raw } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z"),
    },
    handler: () => jsonResponse(200, BROKEN),
  });

  await assert.rejects(() => sync.load(), EventDataError);
  // 壊れたデータで手元の下書きを潰さない
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), draft);
  assert.equal(JSON.parse(raw(BASE_KEY)), "2026-08-09T10:00:00.000Z");
});

test("リモートが取れなければローカルへ落ちる（source === 'offline'）", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z");
  const { sync } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z"),
    },
    handler: () => {
      throw new TypeError("Failed to fetch");
    },
  });

  const { result: out } = await captureConsole(() => sync.load());
  assert.deepEqual(out.data, draft);
  assert.equal(out.source, "offline");
  assert.equal(out.remoteUpdatedAt, null);
});

test("HTTP エラーもオフライン扱いにする", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z");
  const { sync } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z"),
    },
    handler: () => jsonResponse(503, { error: "down" }),
  });
  const { result: out } = await captureConsole(() => sync.load());
  assert.equal(out.source, "offline");
  assert.deepEqual(out.data, draft);
});

test("リモートも下書きも無ければ load() は例外にする", async () => {
  const { sync } = setup({
    handler: () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await assert.rejects(() => captureConsole(() => sync.load()), /取得できません/);
});

test("updatedAt を持たないリモートをオフライン扱いにしない", async () => {
  // remoteUpdatedAt に null を渡すと decideSync が offline を返してしまう。
  // 「取れているのに取れていない」ことになるので、取得できた事実のほうを優先する。
  const remote = { days: DAYS, events: [ev()] };
  const { sync } = setup({ handler: () => jsonResponse(200, remote) });
  const out = await sync.load();
  assert.equal(out.source, "use-remote");
  assert.deepEqual(out.data, remote);
  assert.equal(out.remoteUpdatedAt, null);
});

test("取り込みを保存できなくても旅程は表示する", async () => {
  // 閲覧しかしない端末を保存領域の都合で締め出さない。
  // 保存が要る場面（saveLocal / adoptRemote）では失敗を投げる
  const remote = plan("2026-08-09T10:00:00.000Z");
  const backend = memoryBackend();
  backend.setItem = () => {
    throw new Error("quota");
  };
  const sync = createSync({
    store: createStore(backend),
    fetchImpl: fakeFetch(() => jsonResponse(200, remote)),
    config: CONFIG,
    now,
  });

  const { result: out, seen } = await captureConsole(() => sync.load());
  assert.deepEqual(out.data, remote);
  assert.equal(out.source, "use-remote");
  assert.equal(seen.length, 1); // 黙って捨てない
});

test("未公開の変更があるときはリモートで黙って上書きしない", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z", [ev({ title: "手元で直した昼食" })]);
  const remote = plan("2026-08-09T10:30:00.000Z");
  const { sync, raw } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z"),
    },
    handler: () => jsonResponse(200, remote),
  });

  const out = await sync.load();
  assert.equal(out.source, "remote-is-newer");
  assert.deepEqual(out.data, draft); // 表示は手元のまま
  assert.equal(out.remoteUpdatedAt, "2026-08-09T10:30:00.000Z");
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), draft);
  assert.equal(JSON.parse(raw(BASE_KEY)), "2026-08-09T10:00:00.000Z");
});

test("リモートが進んでいなければローカルを使う（source === 'use-local'）", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z", [ev({ title: "手元で直した昼食" })]);
  const remote = plan("2026-08-09T10:00:00.000Z");
  const { sync } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z"),
    },
    handler: () => jsonResponse(200, remote),
  });
  const out = await sync.load();
  assert.equal(out.source, "use-local");
  assert.deepEqual(out.data, draft);
});

// --------------------------------------------------------- sync: saveLocal

test("saveLocal() は updatedAt を現在時刻に更新して保存する", () => {
  const original = plan("2020-01-01T00:00:00.000Z");
  const { sync, raw } = setup({
    initial: { [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z") },
  });

  const saved = sync.saveLocal(original);

  assert.equal(saved.updatedAt, FIXED_ISO);
  assert.equal(JSON.parse(raw(DRAFT_KEY)).updatedAt, FIXED_ISO);
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)).events, original.events);
  // 渡されたオブジェクトを書き換えない
  assert.equal(original.updatedAt, "2020-01-01T00:00:00.000Z");
  // 下書きの保存は同期ではない。base を動かすと未公開の変更が消えたことになる
  assert.equal(JSON.parse(raw(BASE_KEY)), "2026-08-09T10:00:00.000Z");
});

test("saveLocal() は検証に通らないデータを保存しない", () => {
  // 通してしまうと、次の読み込みで画面が起動しない下書きが出来上がる
  const { sync, raw } = setup();
  assert.throws(() => sync.saveLocal(BROKEN), EventDataError);
  assert.equal(raw(DRAFT_KEY), undefined);
});

// ----------------------------------------------------------- sync: publish

test("publish() は検証に通らなければ API を一度も叩かない", async () => {
  const { sync, store, fetchImpl } = setup({ handler: () => jsonResponse(200, {}) });
  writeToken(store, "ghp_secret");

  await assert.rejects(() => sync.publish(BROKEN), EventDataError);
  assert.equal(fetchImpl.calls.length, 0);
});

test("publish() は GET で sha を取り、PUT で送り、base を更新する", async () => {
  const data = plan("2026-08-09T10:00:00.000Z");
  const { sync, store, fetchImpl, raw } = setup({
    handler: (url, init) => {
      if (init.method === "PUT") {
        return jsonResponse(201, {
          content: { sha: "new-sha" },
          commit: { html_url: "https://github.com/acme/trip/commit/abc" },
        });
      }
      return jsonResponse(200, { sha: "old-sha", content: toBase64Utf8(JSON.stringify(data)) });
    },
  });
  writeToken(store, "ghp_secret");

  const out = await sync.publish(data);

  assert.equal(out.commitUrl, "https://github.com/acme/trip/commit/abc");
  // 順序: GET が先、PUT が後
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].method, "GET");
  assert.equal(fetchImpl.calls[1].method, "PUT");
  assert.match(fetchImpl.calls[0].url, new RegExp(`^${CONTENTS_URL}\\?ref=dev$`));
  assert.equal(fetchImpl.calls[1].url, CONTENTS_URL);

  const body = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal(body.sha, "old-sha"); // GET で取った sha を使う
  assert.equal(body.branch, "dev");
  assert.equal(body.message, "Update itinerary from the browser (1 event)");
  const sent = JSON.parse(fromBase64Utf8(body.content));
  assert.equal(sent.updatedAt, FIXED_ISO); // 送る内容の updatedAt も現在時刻
  assert.deepEqual(sent.events, data.events);

  // 成功して初めて base を進める
  assert.equal(JSON.parse(raw(BASE_KEY)), FIXED_ISO);
  assert.equal(JSON.parse(raw(DRAFT_KEY)).updatedAt, FIXED_ISO);
});

test("publish() は日本語を壊さずに送る", async () => {
  const data = plan("2026-08-09T10:00:00.000Z", [
    ev({ title: "ワット アルン 🛕" }),
    ev({ id: "ev-2", title: "夕食" }),
  ]);
  const { sync, store, fetchImpl } = setup({
    handler: (url, init) =>
      init.method === "PUT"
        ? jsonResponse(201, { content: { sha: "s" }, commit: { html_url: "https://x/1" } })
        : jsonResponse(200, { sha: "old", content: toBase64Utf8("{}") }),
  });
  writeToken(store, "ghp_secret");
  await sync.publish(data);
  const body = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal(JSON.parse(fromBase64Utf8(body.content)).events[0].title, "ワット アルン 🛕");
  assert.equal(body.message, "Update itinerary from the browser (2 events)");
});

test("リモートにファイルが無ければ sha なしで作成する", async () => {
  const data = plan("2026-08-09T10:00:00.000Z");
  const { sync, store, fetchImpl } = setup({
    handler: (url, init) =>
      init.method === "PUT"
        ? jsonResponse(201, { content: { sha: "s" }, commit: { html_url: "https://x/1" } })
        : jsonResponse(404, { message: "Not Found" }),
  });
  writeToken(store, "ghp_secret");

  await sync.publish(data);
  const body = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal("sha" in body, false);
});

test("409 は握りつぶさず、下書きも base も残す", async () => {
  // Task 9 は「取り込んでから公開し直す」導線を出す。下書きを消すとその道が塞がる
  const draft = plan("2026-08-09T11:00:00.000Z", [ev({ title: "手元で直した昼食" })]);
  const { sync, store, raw } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z"),
    },
    handler: (url, init) =>
      init.method === "PUT"
        ? jsonResponse(409, { message: "does not match" })
        : jsonResponse(200, { sha: "old", content: toBase64Utf8("{}") }),
  });
  writeToken(store, "ghp_secret");

  await assert.rejects(
    () => sync.publish(draft),
    (error) => error instanceof GitHubError && error.status === 409
  );

  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), draft);
  // 失敗した公開を「同期済み」に見せない
  assert.equal(JSON.parse(raw(BASE_KEY)), "2026-08-09T10:00:00.000Z");
});

test("GET が失敗した時点で PUT へ進まない", async () => {
  const data = plan("2026-08-09T10:00:00.000Z");
  const { sync, store, fetchImpl, raw } = setup({
    handler: () => jsonResponse(401, { message: "Bad credentials" }),
  });
  writeToken(store, "ghp_secret");

  await assert.rejects(
    () => sync.publish(data),
    (error) => error instanceof GitHubError && error.status === 401
  );
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(raw(BASE_KEY), undefined);
});

test("トークンが無ければ通信せずに GitHubError になる", async () => {
  const data = plan("2026-08-09T10:00:00.000Z");
  const { sync, store, fetchImpl } = setup({
    handler: (url, init) =>
      init.method === "PUT"
        ? jsonResponse(201, { content: { sha: "s" }, commit: { html_url: "https://x/1" } })
        : jsonResponse(200, { sha: "old", content: toBase64Utf8("{}") }),
  });

  await assert.rejects(
    () => sync.publish(data),
    (error) => error instanceof GitHubError && error.status === 0
  );
  assert.equal(fetchImpl.calls.length, 0);

  // トークンは公開のたびに読む。createSync のあとに設定しても効く
  writeToken(store, "ghp_secret");
  assert.equal((await sync.publish(data)).commitUrl, "https://x/1");
});

test("トークンは Authorization 以外のどこにも出さない", async () => {
  const TOKEN = "ghp_do_not_leak_0123456789";
  const data = plan("2026-08-09T10:00:00.000Z");
  const { sync, store, fetchImpl } = setup({
    handler: (url, init) =>
      init.method === "PUT"
        ? jsonResponse(409, { message: "does not match" })
        : jsonResponse(200, { sha: "old", content: toBase64Utf8("{}") }),
  });
  writeToken(store, TOKEN);

  const { result: error, seen } = await captureConsole(() =>
    sync.publish(data).catch((e) => e)
  );

  assert.equal(error.status, 409);
  assert.equal(error.message.includes(TOKEN), false);
  assert.equal(String(error.stack).includes(TOKEN), false);
  assert.equal(seen.join("\n").includes(TOKEN), false);
  for (const call of fetchImpl.calls) {
    assert.equal(call.url.includes(TOKEN), false);
    assert.equal(String(call.init.body ?? "").includes(TOKEN), false);
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
  }
});

// ------------------------------------------------------- sync: adoptRemote

test("adoptRemote() はローカルを捨ててリモートを入れ、base を揃える", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z", [ev({ title: "手元で直した昼食" })]);
  const remote = plan("2026-08-09T12:30:00.000Z", [ev({ title: "リモートの昼食" })]);
  const { sync, raw } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z"),
    },
    handler: () => jsonResponse(200, remote),
  });

  const adopted = await sync.adoptRemote();

  assert.deepEqual(adopted, remote);
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), remote);
  assert.equal(JSON.parse(raw(BASE_KEY)), "2026-08-09T12:30:00.000Z");

  // 取り込んだ直後の load() は衝突を出さない
  const out = await sync.load();
  assert.equal(out.source, "use-local");
  assert.deepEqual(out.data, remote);
});

test("adoptRemote() は壊れたリモートを取り込まない", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z");
  const { sync, raw } = setup({
    initial: { [DRAFT_KEY]: JSON.stringify(draft) },
    handler: () => jsonResponse(200, BROKEN),
  });

  await assert.rejects(() => sync.adoptRemote(), EventDataError);
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), draft);
});

test("adoptRemote() は取得に失敗したら例外にし、下書きを消さない", async () => {
  // 押したのに何も起きない、が一番困る。失敗は必ず外へ出す
  const draft = plan("2026-08-09T11:00:00.000Z");
  const { sync, raw } = setup({
    initial: { [DRAFT_KEY]: JSON.stringify(draft) },
    handler: () => {
      throw new TypeError("Failed to fetch");
    },
  });

  await assert.rejects(() => sync.adoptRemote(), /取得できません/);
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), draft);
});
