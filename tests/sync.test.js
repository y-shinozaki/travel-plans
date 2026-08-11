import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createSync, DEFAULT_CONFIG } from "../assets/js/sync.js";
import { readToken, writeToken, clearToken, hasToken } from "../assets/js/token.js";
import { createStore, StoreWriteError } from "../assets/js/store.js";
import { EventDataError } from "../assets/js/validate.js";
import { GitHubError } from "../assets/js/github.js";
import { toBase64Utf8, fromBase64Utf8 } from "../assets/js/base64.js";
import { deriveKey, createCodec, SALT_BYTES, DecryptError } from "../assets/js/crypto.js";

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

/** リモートに置かれている版の時刻。 */
const REMOTE_STAMP = "2026-08-09T10:00:00.000Z";
/** その版を取り込み済み ＝ 競合していない store の初期状態。 */
const SYNCED = { [BASE_KEY]: JSON.stringify(REMOTE_STAMP) };

const OK_PUT = () =>
  jsonResponse(201, {
    content: { sha: "new-sha" },
    commit: { html_url: "https://github.com/acme/trip/commit/abc" },
  });

/** GET はリモートの現物（sha と本文）を返し、PUT は put() を返す GitHub。 */
function github({ remote = plan(REMOTE_STAMP), sha = "old-sha", put = OK_PUT } = {}) {
  return (url, init) =>
    init.method === "PUT"
      ? put()
      : jsonResponse(200, { sha, content: toBase64Utf8(JSON.stringify(remote)) });
}

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

test("空白だけの値はトークン扱いしない", () => {
  const store = createStore(memoryBackend({ "tp:gh-token": "  \n" }));
  assert.equal(readToken(store), null);
  assert.equal(hasToken(store), false);
});

test("トークンは JSON として解釈しない（中身が console に出る経路を作らない）", async () => {
  // store.read は壊れた値を JSON.parse に掛け、SyntaxError の文言に中身の先頭が
  // 埋め込まれる（Unexpected token 'g', "ghp_liveSe"... ）。それが console.warn に出る。
  // トークンだけは平文で読み書きし、この経路自体を作らない
  const TOKEN = "ghp_liveSecretValue0123456789";
  const store = createStore(memoryBackend({ "tp:gh-token": TOKEN }));

  const { result, seen } = await captureConsole(async () => ({
    token: readToken(store),
    has: hasToken(store),
  }));

  assert.equal(result.token, TOKEN);
  assert.equal(result.has, true);
  assert.equal(seen.length, 0, `console に出力があった: ${seen.join(" / ")}`);
});

test("保存に失敗してもトークンを例外文に出さない", () => {
  const TOKEN = "ghp_liveSecretValue0123456789";
  const backend = memoryBackend();
  backend.setItem = () => {
    throw new Error("quota");
  };
  assert.throws(
    () => writeToken(createStore(backend), TOKEN),
    (error) =>
      error instanceof StoreWriteError &&
      !error.message.includes(TOKEN) &&
      /tp:gh-token/.test(error.message)
  );
});

// ------------------------------------------------------------ sync: 既定値

test("DEFAULT_CONFIG は実在するファイルを指す", () => {
  assert.equal(DEFAULT_CONFIG.path, "assets/data/events.json");
  // cwd に依存させない。リポジトリのルートはこのファイルの 1 つ上
  assert.equal(existsSync(new URL(`../${DEFAULT_CONFIG.path}`, import.meta.url)), true);
  assert.equal(DEFAULT_CONFIG.owner, "y-shinozaki");
  assert.equal(DEFAULT_CONFIG.repo, "travel-plans");
  assert.equal(DEFAULT_CONFIG.branch, "main");
});

// -------------------------------------------------------------- sync: load

test("下書きが無ければリモートを取り込んで返す", async () => {
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

test("readDraft() は、load() が投げる状況でも検証を通った下書きを返す", async () => {
  // events.json の手編集を廃止したあとの復旧手段は「正しい下書きを持つ端末が
  // 公開し直す」の 1 本だけ（設計書 §6.5）。リモートが検証に落ちて load() が
  // 投げても、下書き自体が壊れているとは限らない ── readDraft() は load() と
  // 同じ検証（readValidDraft）を通した下書きを、load() の成否と無関係に返す
  const draft = plan("2026-08-09T11:00:00.000Z");
  const { sync } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify("2026-08-09T10:00:00.000Z"),
    },
    handler: () => jsonResponse(200, BROKEN),
  });

  await assert.rejects(() => sync.load(), EventDataError);
  assert.deepEqual(sync.readDraft(), draft);
});

test("readDraft() は壊れた下書きには null を返す", async () => {
  const broken = plan("2026-08-09T11:00:00.000Z", [ev({ cat: "cat-NOPE", startDay: 99 })]);
  const { sync } = setup({ initial: { [DRAFT_KEY]: JSON.stringify(broken) } });

  const { result } = await captureConsole(() => sync.readDraft());
  assert.equal(result, null);
});

test("readDraft() は下書きが無ければ null を返す", () => {
  const { sync } = setup();
  assert.equal(sync.readDraft(), null);
});

test("リモート本文がリテラルの null でも検証で弾く", async () => {
  // null をセンチネルに使うと「取れなかった」と区別が付かず、
  // 最後に throw null をやってしまう（呼び出し側の error.message が TypeError になる）
  const { sync } = setup({ handler: () => jsonResponse(200, null) });
  await assert.rejects(() => sync.load(), EventDataError);
});

test("壊れた下書きは使わずリモートへ落とし、値は消さない", async () => {
  // 旅程の日数を減らすだけで、他の端末に残っている下書きは範囲外になる。
  // 手で書き換えなくても起こるので「アプリ経由なら壊れない」とは言えない。
  // 壊れたリモートを画面に出さないのに壊れた下書きは出す、では筋が通らない
  const broken = plan("2026-08-09T11:00:00.000Z", [ev({ cat: "cat-NOPE", startDay: 99 })]);
  const remote = plan("2026-08-09T10:00:00.000Z");
  const { sync, raw } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(broken),
      [BASE_KEY]: JSON.stringify("2026-08-09T09:00:00.000Z"),
    },
    handler: () => jsonResponse(200, remote),
  });

  const { result: out, seen } = await captureConsole(() => sync.load());

  assert.deepEqual(out.data, remote);
  assert.equal(out.source, "use-remote");
  assert.equal(seen.length, 1); // 黙って捨てない
  // 救い出せるよう、保存されている値には触らない
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), broken);
});

test("壊れた下書きしかなくリモートも取れなければ例外", async () => {
  const broken = plan("2026-08-09T11:00:00.000Z", [ev({ cat: "cat-NOPE", startDay: 99 })]);
  const { sync, raw } = setup({
    initial: { [DRAFT_KEY]: JSON.stringify(broken) },
    handler: () => {
      throw new TypeError("Failed to fetch");
    },
  });

  await assert.rejects(() => captureConsole(() => sync.load()), /取得できません/);
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), broken);
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
  // 黙って捨てない。件数は数えない ── 書き込む控えが増える（指紋など）たびに
  // 数がずれて、テストが別のものを試し始める。「取り込んだ内容を保存できな
  // かったことが出ている」ことだけを見る
  assert.ok(seen.length >= 1, "保存の失敗が黙って捨てられています");
  assert.ok(
    seen.some((line) => line.includes("取り込んだ内容を保存できませんでした")),
    `取り込みの失敗が出ていません: ${seen.join(" / ")}`
  );
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

// ------------------------------------------ sync: hasUnpublishedChanges

test("ページを 2 回開いただけの端末に未公開の変更は無い", async () => {
  // source では代用できないことの本体。1 回目の use-remote が下書きと base を
  // 書くので、2 回目は編集していなくても use-local になる。それを「未公開の
  // 変更あり」と読むと、公開ボタンが永久に警告を出し続ける
  const remote = plan(REMOTE_STAMP);
  const { sync } = setup({ handler: () => jsonResponse(200, remote) });

  const first = await sync.load();
  assert.equal(first.source, "use-remote");
  assert.equal(sync.hasUnpublishedChanges(), false);

  const second = await sync.load();
  assert.equal(second.source, "use-local", "前提: 2 回目は use-local になる");
  assert.equal(second.data.updatedAt, REMOTE_STAMP);
  assert.equal(
    sync.hasUnpublishedChanges(),
    false,
    "一度も編集していないのに未公開の変更があることになっています"
  );
});

test("保存すると未公開の変更になり、公開すると消える", async () => {
  const { sync, store } = setup({ initial: SYNCED, handler: github() });
  store.write("events", plan(REMOTE_STAMP));
  assert.equal(sync.hasUnpublishedChanges(), false);

  sync.saveLocal(plan(REMOTE_STAMP, [ev({ title: "手元で直した昼食" })]));
  assert.equal(sync.hasUnpublishedChanges(), true);

  writeToken(store, "ghp_secret");
  await sync.publish(plan(REMOTE_STAMP, [ev({ title: "手元で直した昼食" })]));
  assert.equal(sync.hasUnpublishedChanges(), false, "公開したのに残っています");
});

test("取り込むと未公開の変更は消える", async () => {
  const remote = plan("2026-08-09T12:30:00.000Z", [ev({ title: "リモートの昼食" })]);
  const { sync } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")),
      [BASE_KEY]: JSON.stringify(REMOTE_STAMP),
    },
    handler: () => jsonResponse(200, remote),
  });
  assert.equal(sync.hasUnpublishedChanges(), true);
  await sync.adoptRemote();
  assert.equal(sync.hasUnpublishedChanges(), false);
});

test("下書きが無ければ未公開の変更も無い", () => {
  const { sync } = setup({ initial: SYNCED });
  assert.equal(sync.hasUnpublishedChanges(), false);
});

test("base が無い下書きは未公開の変更として扱う", () => {
  // 取り込んだ証拠がない ＝ 公開済みだと言い切れない。
  // 判断できないほうへ倒すと「公開できるのにボタンが何も言わない」になる
  const { sync } = setup({ initial: { [DRAFT_KEY]: JSON.stringify(plan(REMOTE_STAMP)) } });
  assert.equal(sync.hasUnpublishedChanges(), true);
});

test("updatedAt を持たないリモートを取り込んだ端末も「揃っている」", () => {
  // stampOf も base も null。時刻の大小で見ていると比較が成立しないが、
  // 一致で見るので正しく「揃っている」になる
  const { sync, store } = setup();
  store.write("events", { days: DAYS, events: [ev()] });
  store.write("events-base", null);
  assert.equal(sync.hasUnpublishedChanges(), false);
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
  const data = plan(REMOTE_STAMP);
  const { sync, store, fetchImpl, raw } = setup({ initial: SYNCED, handler: github() });
  writeToken(store, "ghp_secret");

  const out = await sync.publish(data);

  assert.equal(out.commitUrl, "https://github.com/acme/trip/commit/abc");
  assert.equal(out.conflictChecked, true, "突き合わせをした事実が返っていません");
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
  const data = plan(REMOTE_STAMP, [
    ev({ title: "ワット アルン 🛕" }),
    ev({ id: "ev-2", title: "夕食" }),
  ]);
  const { sync, store, fetchImpl } = setup({ initial: SYNCED, handler: github() });
  writeToken(store, "ghp_secret");
  await sync.publish(data);
  const body = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal(JSON.parse(fromBase64Utf8(body.content)).events[0].title, "ワット アルン 🛕");
  assert.equal(body.message, "Update itinerary from the browser (2 events)");
});

test("リモートにファイルが無ければ sha なしで作成する", async () => {
  const data = plan(REMOTE_STAMP);
  const { sync, store, fetchImpl } = setup({
    handler: (url, init) =>
      init.method === "PUT" ? OK_PUT() : jsonResponse(404, { message: "Not Found" }),
  });
  writeToken(store, "ghp_secret");

  await sync.publish(data);
  const body = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal("sha" in body, false);
});

test("開いたあとに別端末が公開していたら PUT へ進まない", async () => {
  // 現実の競合はこれ。sha は公開の直前に取り直すので常に最新であり、
  // sha 任せでは 201 で通ってしまって相手の作業が黙って消える。
  // 起動時の decideSync は開いたままの 30 分を見張れない
  const draft = plan("2026-08-09T11:00:00.000Z", [ev({ title: "手元で直した昼食" })]);
  const { sync, store, fetchImpl, raw } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify(REMOTE_STAMP), // 取り込んだのは 10:00 の版
    },
    // が、その後に相手が 11:30 の版を公開している
    handler: github({ remote: plan("2026-08-09T11:30:00.000Z"), sha: "brand-new-sha" }),
  });
  writeToken(store, "ghp_secret");

  await assert.rejects(
    () => sync.publish(draft),
    (error) => error instanceof GitHubError && error.status === 409
  );

  // GET だけで止まる。相手の版を踏まない
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].method, "GET");
  // 取り込んでから公開し直せるよう、下書きも base もそのまま
  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), draft);
  assert.equal(JSON.parse(raw(BASE_KEY)), REMOTE_STAMP);
});

test("取り込んだ証拠（base）が無ければ公開しない", async () => {
  // 上書きしてよい根拠がない状態。迷ったら人に決めさせる側へ倒す
  const data = plan(REMOTE_STAMP);
  const { sync, store, fetchImpl } = setup({ handler: github() });
  writeToken(store, "ghp_secret");

  await assert.rejects(
    () => sync.publish(data),
    (error) => error instanceof GitHubError && error.status === 409
  );
  assert.equal(fetchImpl.calls.length, 1);
});

test("リモートの updatedAt が読めないときは突き合わせを省いて公開する", async () => {
  // リモートが壊れているとき、公開そのものが復旧手段になる。
  // ここで止めるとブラウザから直せなくなるので通す（ただし黙って通さない）
  const data = plan(REMOTE_STAMP);
  const { sync, store, fetchImpl } = setup({
    initial: SYNCED,
    handler: (url, init) =>
      init.method === "PUT"
        ? OK_PUT()
        : jsonResponse(200, { sha: "old", content: toBase64Utf8("こわれている") }),
  });
  writeToken(store, "ghp_secret");

  const { result, seen } = await captureConsole(() => sync.publish(data));
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[1].method, "PUT");
  // 黙って通さない。件数は数えない ── 判断の段階が増えるたびに数がずれて、
  // テストが別のものを試し始める
  assert.ok(
    seen.some((line) => line.includes("突き合わせを省略します")),
    `省略したことが console に出ていません: ${seen.join(" / ")}`
  );
  // console.warn だけでは、唯一ガードが効いていない場面を誰も知らないまま
  // 公開が済んでしまう。画面に出せるよう戻り値でも伝えること
  assert.equal(result.conflictChecked, false, "省略した事実が返っていません");
});

test("409 は握りつぶさず、下書きも base も残す", async () => {
  // GET と PUT の間に滑り込まれた場合の最後の保険。
  // Task 9 は「取り込んでから公開し直す」導線を出す。下書きを消すとその道が塞がる
  const draft = plan("2026-08-09T11:00:00.000Z", [ev({ title: "手元で直した昼食" })]);
  const { sync, store, raw } = setup({
    initial: {
      [DRAFT_KEY]: JSON.stringify(draft),
      [BASE_KEY]: JSON.stringify(REMOTE_STAMP),
    },
    handler: github({ put: () => jsonResponse(409, { message: "does not match" }) }),
  });
  writeToken(store, "ghp_secret");

  await assert.rejects(
    () => sync.publish(draft),
    (error) => error instanceof GitHubError && error.status === 409
  );

  assert.deepEqual(JSON.parse(raw(DRAFT_KEY)), draft);
  // 失敗した公開を「同期済み」に見せない
  assert.equal(JSON.parse(raw(BASE_KEY)), REMOTE_STAMP);
});

test("GET が失敗した時点で PUT へ進まない", async () => {
  const data = plan(REMOTE_STAMP);
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
  const data = plan(REMOTE_STAMP);
  const { sync, store, fetchImpl } = setup({ initial: SYNCED, handler: github() });

  await assert.rejects(
    () => sync.publish(data),
    (error) => error instanceof GitHubError && error.status === 0
  );
  assert.equal(fetchImpl.calls.length, 0);

  // トークンは公開のたびに読む。createSync のあとに設定しても効く
  writeToken(store, "ghp_secret");
  assert.equal(
    (await sync.publish(data)).commitUrl,
    "https://github.com/acme/trip/commit/abc"
  );
});

test("トークンは Authorization 以外のどこにも出さない", async () => {
  const TOKEN = "ghp_do_not_leak_0123456789";
  const data = plan(REMOTE_STAMP);
  const { sync, store, fetchImpl } = setup({
    initial: SYNCED,
    handler: github({ put: () => jsonResponse(409, { message: "does not match" }) }),
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

// ------------------------------------------------- sync: B4 の注入口（5 つ）

/**
 * days は validateEvents が中身（date / dow）まで見るので、B4 専用の
 * イベントデータも既存の DAYS と同じ形にする（["8/12", ...] のような文字列配列は
 * checkDays に「オブジェクトではない」と弾かれる）。
 */
const B4_DATA = {
  updatedAt: "2026-08-10T00:00:00.000Z",
  days: DAYS,
  events: [
    {
      id: "ev-1",
      cat: "cat-move",
      title: "出国",
      allDay: false,
      startDay: 0,
      endDay: 0,
      start: 10,
      end: 12,
      location: "羽田",
      lat: 35.55,
      lng: 139.78,
      url: "",
      notes: "",
      image: "",
      imagePos: "",
    },
  ],
};

async function b4Codec() {
  const salt = new Uint8Array(SALT_BYTES).fill(2);
  const key = await deriveKey("ひみつの合言葉", salt, 1000);
  return createCodec({ key, salt, iterations: 1000 });
}

/**
 * fetch と GitHub API の最小スタブ。text には現在の本文（リモートの生 JSON 文字列）が
 * 入り、PUT のたびに書き換わる。puts には送られた PUT の本文（base64 化前）を積む。
 *
 * btoa(unescape(...)) / atob 経由の手書きデコードは使わず、このリポジトリの
 * base64.js（toBase64Utf8 / fromBase64Utf8）をそのまま使う ── unescape / escape は
 * deprecated な global で、同じ変換をこのプロジェクトのやり方でも書けるため。
 */
function fakeRemote(initialText) {
  const state = { text: initialText, puts: [] };
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith("https://api.github.com")) {
      if ((options.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sha: "sha-1", content: toBase64Utf8(state.text) }),
        };
      }
      const body = JSON.parse(options.body);
      state.puts.push(body);
      state.text = fromBase64Utf8(body.content);
      return {
        ok: true,
        status: 200,
        // putFile は content.sha と commit.html_url の両方が無いと
        // 「予期しない応答」として弾く（github.js 参照）
        json: async () => ({
          content: { sha: "put-sha" },
          commit: { html_url: "https://example/commit" },
        }),
      };
    }
    // text() も返す。sync.fetchRemote は配信されたバイト列そのものから
    // 指紋を作るので（fingerprint.js）、実物の Response と同じ形にしておく
    return {
      ok: true,
      status: 200,
      text: async () => state.text,
      json: async () => JSON.parse(state.text),
    };
  };
  return { state, fetchImpl };
}

test("codec を注入すると封筒を PUT し、読むときは復号する", async () => {
  const codec = await b4Codec();
  const store = createStore(memoryBackend());
  const { state, fetchImpl } = fakeRemote(JSON.stringify(B4_DATA));

  const sync = createSync({
    store,
    fetchImpl,
    config: { ...DEFAULT_CONFIG, codec },
  });

  writeToken(store, "ghp_test");
  const loaded = await sync.load();
  assert.deepEqual(loaded.data.events, B4_DATA.events); // 平文リモートを素通しで読めた

  await sync.publish(loaded.data);

  const published = JSON.parse(state.text);
  assert.equal(typeof published.ct, "string"); // 封筒になった
  assert.ok(!state.text.includes("出国")); // 行き先が出ていない
  assert.equal(typeof published.updatedAt, "string"); // 外側の updatedAt は残る
});

test("封筒になったリモートを次の起動で読める", async () => {
  const codec = await b4Codec();
  const envelope = await codec.encode(B4_DATA);
  const { fetchImpl } = fakeRemote(JSON.stringify(envelope));

  const sync = createSync({
    store: createStore(memoryBackend()),
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
  const { fetchImpl } = fakeRemote(
    JSON.stringify({ ...envelope, updatedAt: "2030-01-01T00:00:00.000Z" })
  );

  const sync = createSync({
    store: createStore(memoryBackend()),
    fetchImpl,
    config: { ...DEFAULT_CONFIG, codec },
  });

  const loaded = await sync.load();
  assert.equal(loaded.outerStampMismatch, true);
  assert.equal(loaded.data.updatedAt, B4_DATA.updatedAt); // 内側が正
});

test("復号できないリモートは DecryptError のまま投げる（握らない）", async () => {
  const mine = await b4Codec();
  const otherSalt = new Uint8Array(SALT_BYTES).fill(8);
  const other = createCodec({
    key: await deriveKey("違う合言葉", otherSalt, 1000),
    salt: otherSalt,
    iterations: 1000,
  });
  const { fetchImpl } = fakeRemote(JSON.stringify(await other.encode(B4_DATA)));

  const sync = createSync({
    store: createStore(memoryBackend()),
    fetchImpl,
    config: { ...DEFAULT_CONFIG, codec: mine },
  });

  await assert.rejects(
    () => sync.load(),
    (e) => e instanceof DecryptError && e.reason === "wrong-key"
  );
});

test("突き合わせは封筒の外側の updatedAt で効く", async () => {
  const codec = await b4Codec();
  const store = createStore(memoryBackend());
  const { state, fetchImpl } = fakeRemote(JSON.stringify(await codec.encode(B4_DATA)));

  const sync = createSync({ store, fetchImpl, config: { ...DEFAULT_CONFIG, codec } });
  writeToken(store, "ghp_test");
  await sync.load();

  // 別端末が先に公開した状況を作る（外側の updatedAt だけ進める）
  const ahead = { ...JSON.parse(state.text), updatedAt: "2031-01-01T00:00:00.000Z" };
  state.text = JSON.stringify(ahead);

  await assert.rejects(() => sync.publish(B4_DATA), (e) => e.status === 409);
  assert.equal(state.puts.length, 0); // PUT は飛んでいない
});

test("draftKey / baseKey を差し替えると別のキーに書く", async () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  const { fetchImpl } = fakeRemote(JSON.stringify(B4_DATA));

  const sync = createSync({
    store,
    fetchImpl,
    config: { ...DEFAULT_CONFIG, draftKey: "packing", baseKey: "packing-base" },
  });
  await sync.load();

  const dump = backend._dump();
  assert.ok("tp:packing" in dump);
  assert.ok("tp:packing-base" in dump);
  assert.ok(!("tp:events" in dump)); // 旅程の下書きを踏まない
  assert.ok(!("tp:events-base" in dump));
});

test("validate を差し替えると旅程以外も通せる", async () => {
  const packing = { updatedAt: "2026-08-10T00:00:00.000Z", groups: [] };
  const { fetchImpl } = fakeRemote(JSON.stringify(packing));

  const sync = createSync({
    store: createStore(memoryBackend()),
    fetchImpl,
    config: {
      ...DEFAULT_CONFIG,
      draftKey: "packing",
      baseKey: "packing-base",
      validate: (data) => data, // 持ち物用の検証器の代わり
      commitMessage: () => "Update packing from the browser",
    },
  });

  const loaded = await sync.load();
  assert.deepEqual(loaded.data, packing);
});

test("commitMessage を差し替えるとコミット文が変わる", async () => {
  const store = createStore(memoryBackend());
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
  const backend = memoryBackend();
  const store = createStore(backend);
  const { state, fetchImpl } = fakeRemote(JSON.stringify(B4_DATA));

  const sync = createSync({ store, fetchImpl }); // config を渡さない
  writeToken(store, "ghp_test");
  await sync.load();
  await sync.publish(B4_DATA);

  const dump = backend._dump();
  assert.ok("tp:events" in dump);
  assert.ok("tp:events-base" in dump);
  assert.equal(state.puts.at(-1).message, "Update itinerary from the browser (1 event)");
  assert.equal(JSON.parse(state.text).ct, undefined); // 平文のまま
});

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

// ── 404 と通信断の区別（Task 4） ─────────────────────────────────
//
// packing.json はまだリポジトリに存在しない。素の fetch は 404 を返す。
// fetchRemote が投げる Error に status を乗せて、呼び出し側が
// 「まだ無い」と「取れなかった」を見分けられるようにする。

test("404 は status を持った失敗として投げる（まだ無いファイルと通信断を区別する）", async () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  const sync = createSync({
    store,
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => "", json: async () => ({}) }),
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

  await captureConsole(() =>
    assert.rejects(
      () => sync.load(),
      (error) => {
        assert.equal(error.status, 404, "status が付いていません");
        assert.match(error.message, /持ち物/, "noun が文言に効いていません");
        return true;
      }
    )
  );
});

test("通信断には status が付かない（404 と取り違えない）", async () => {
  const { sync } = setup({
    handler: () => {
      throw new TypeError("Failed to fetch");
    },
  });

  await captureConsole(() =>
    assert.rejects(
      () => sync.load(),
      (error) => {
        assert.equal(error.status, undefined);
        return true;
      }
    )
  );
});

/* ── 保存領域に書けない端末（設計書 §13） ─────────────── */

/** 公開にはトークンが要る。中身は使われないので何でもよい。 */
const WITH_TOKEN = { "tp:gh-token": "ghp_test" };

/**
 * 素の GET（load / adoptRemote が読む配信ファイル）と Contents API の
 * 両方を返すハンドラ。github() は API しか返さないので、取り込みまで
 * 通すテストではこちらを使う。
 */
function siteAndApi({ remote = plan(REMOTE_STAMP), sha = "old-sha", put = OK_PUT } = {}) {
  return (url, init) => {
    if (init?.method === "PUT") return put();
    if (url.startsWith("https://api.github.com")) {
      return jsonResponse(200, { sha, content: toBase64Utf8(JSON.stringify(remote)) });
    }
    return jsonResponse(200, remote);
  };
}

/** setItem が必ず失敗する store。プライベートブラウジングの端末に相当する。 */
function readOnlyStore(initial = {}) {
  const backend = memoryBackend(initial);
  backend.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  return createStore(backend);
}

test("保存領域に書けない端末でも、2 回目以降の公開は 409 にならない", async () => {
  // base を残せないので、これまでは assertRemoteNotAhead が毎回
  // 「取り込んだ証拠が無い」と判断して必ず 409 になっていた。しかも
  // その 409 に添える「取り込んでから公開し直す」も同じ理由で成立しない
  await captureConsole(async () => {
    const store = readOnlyStore(WITH_TOKEN);
    const fetchImpl = fakeFetch(siteAndApi());
    const sync = createSync({ store, fetchImpl, config: CONFIG, now });

    // 1 回目: base が無いので通らない
    await assert.rejects(sync.publish(plan(FIXED_ISO)), (e) => e.status === 409);

    // 取り込みは通る（下書きは書けないが、セッションの記憶に base が残る）
    await assert.rejects(sync.adoptRemote(), StoreWriteError);

    // 2 回目: セッションの記憶が base の代わりになるので 409 では止まらない。
    // 控えは相変わらず書けないので StoreWriteError にはなるが、**PUT は通っている**
    // ── その証拠にコミット URL が載っている（これが出せないと、この端末には
    // 公開できたのか確かめる手段が無い）
    await assert.rejects(sync.publish(plan(FIXED_ISO)), (error) => {
      assert.ok(error instanceof StoreWriteError, `409 のままです: ${error}`);
      assert.equal(error.commitUrl, "https://github.com/acme/trip/commit/abc");
      return true;
    });
  });
});

test("公開が保存に失敗しても、コミット URL は例外から取れる", async () => {
  // 出さないと「本当に公開できたのか」を確かめる手段がリポジトリを
  // 自分で見に行くことだけになる
  await captureConsole(async () => {
    const store = readOnlyStore({ ...WITH_TOKEN, [BASE_KEY]: JSON.stringify(REMOTE_STAMP) });
    const fetchImpl = fakeFetch(github({ remote: plan(REMOTE_STAMP) }));
    const sync = createSync({ store, fetchImpl, config: CONFIG, now });

    await assert.rejects(sync.publish(plan(FIXED_ISO)), (error) => {
      assert.ok(error instanceof StoreWriteError);
      assert.equal(error.commitUrl, "https://github.com/acme/trip/commit/abc");
      return true;
    });
  });
});

test("取り込みが base だけ書けなかったときは、取り込んだ中身を例外に載せる", async () => {
  // 下書きはもう入れ替わっている。画面を古いまま据え置くと、次の編集が
  // その古い内容を保存し直して取り込みを黙って巻き戻す
  await captureConsole(async () => {
    const backend = memoryBackend(WITH_TOKEN);
    const original = backend.setItem.bind(backend);
    // base のキーだけ失敗させる。**呼ばれた回数では数えない** ── 指紋のような
    // 書き込みが増えるたびに数がずれて、テストが別のものを試し始める
    backend.setItem = (k, v) => {
      if (k === BASE_KEY) throw new Error("QuotaExceededError");
      original(k, v);
    };
    const store = createStore(backend);
    const fetchImpl = fakeFetch(siteAndApi());
    const sync = createSync({ store, fetchImpl, config: CONFIG, now });

    await assert.rejects(sync.adoptRemote(), (error) => {
      assert.equal(error.draftWritten, true, "下書きが書けたことが伝わっていません");
      assert.equal(error.adopted?.updatedAt, REMOTE_STAMP);
      return true;
    });
    // 下書きは実際に入れ替わっている
    assert.equal(JSON.parse(backend._dump()[DRAFT_KEY]).updatedAt, REMOTE_STAMP);
  });
});

test("検証を通らないリモートには突き合わせを掛けず、上書きで直せる", async () => {
  /*
   * リモートが「JSON としては読めて updatedAt も進んでいるが、中身が
   * 検証を通らない」形だと、これまでは 409 で止まっていた。逃げ道の
   * 「取り込む」も同じ検証で落ちるので、その端末では直せなかった
   * （設計書 §13）。events.json の手編集を廃止した以上、ブラウザから
   * 直せる経路はこの上書きしか残っていない
   */
  await captureConsole(async () => {
    // BROKEN は days が空なので validateEvents に必ず弾かれる。
    // updatedAt は base より進めておく（＝これまでなら 409 になる条件）
    const ahead = { ...BROKEN, updatedAt: "2026-08-09T11:00:00.000Z" };
    const { sync } = setup({
      initial: { ...SYNCED, ...WITH_TOKEN },
      handler: github({ remote: ahead }),
    });

    const result = await sync.publish(plan(FIXED_ISO));
    assert.equal(typeof result.commitUrl, "string");
    // 突き合わせを省いたことは黙らない
    assert.equal(result.conflictChecked, false);
  });
});

test("検証を通るリモートが進んでいれば、これまでどおり 409 で止める", async () => {
  // 上の逃がし方が広すぎないことの番人。壊れていないリモートまで
  // 上書きできてしまうと、競合検出そのものが無くなる
  const { sync } = setup({
    initial: { ...SYNCED, ...WITH_TOKEN },
    handler: github({ remote: plan("2026-08-09T11:00:00.000Z") }),
  });
  await assert.rejects(sync.publish(plan(FIXED_ISO)), (e) => e.status === 409);
});

test("sync は画面の文言に使う noun を公開する", () => {
  // publish-ui が自分の content.noun と突き合わせるために読む
  const { sync } = setup();
  assert.equal(sync.noun, DEFAULT_CONFIG.noun);
  const other = createSync({
    store: createStore(memoryBackend()),
    fetchImpl: fakeFetch(() => jsonResponse(500, {})),
    config: { ...CONFIG, noun: "持ち物リスト" },
  });
  assert.equal(other.noun, "持ち物リスト");
});

test("時計が巻き戻っていても、内容が変わったリモートは上書きしない", async () => {
  /*
   * 設計書 §13 の残存リスク。base に入る updatedAt は公開した端末の時計で
   * 押されるので、端末間で時計がずれていると順序が保たれない ── あとから
   * 公開された版のほうが「古い」と読まれ、突き合わせが素通りして
   * **他の端末の公開を黙って上書きしていた。**
   *
   * 指紋は時計を一切見ないので、この形の取りこぼしが無くなる。
   */
  await captureConsole(async () => {
    const remote = plan(REMOTE_STAMP);
    const backend = memoryBackend(WITH_TOKEN);
    const store = createStore(backend);
    const state = { remote };
    const fetchImpl = fakeFetch((url, init) => {
      if (init?.method === "PUT") return OK_PUT();
      if (url.startsWith("https://api.github.com")) {
        return jsonResponse(200, {
          sha: "old-sha",
          content: toBase64Utf8(JSON.stringify(state.remote)),
        });
      }
      return jsonResponse(200, state.remote);
    });
    const sync = createSync({ store, fetchImpl, config: CONFIG, now });

    // 起動時にリモートを取り込む → 指紋を覚える
    await sync.load();

    // 別の端末が公開した。**その端末の時計は遅れていて、updatedAt は
    // こちらの base より古い**（＝これまでは「進んでいない」と読まれていた）
    state.remote = plan("2026-08-09T09:00:00.000Z", [ev({ title: "他の端末が直した昼食" })]);

    await assert.rejects(
      sync.publish(plan(FIXED_ISO)),
      (error) => error.status === 409,
      "時計が古い他端末の公開を上書きしています"
    );
  });
});

test("内容が変わっていなければ、指紋があっても公開できる", async () => {
  // 上のガードが広すぎないことの番人。自分が取り込んだままのリモートなら通す
  await captureConsole(async () => {
    const remote = plan(REMOTE_STAMP);
    const store = createStore(memoryBackend(WITH_TOKEN));
    const fetchImpl = fakeFetch(siteAndApi({ remote }));
    const sync = createSync({ store, fetchImpl, config: CONFIG, now });

    await sync.load();
    const result = await sync.publish(plan(FIXED_ISO));
    assert.equal(typeof result.commitUrl, "string");
    assert.equal(result.conflictChecked, true);
  });
});

test("指紋をまだ持たない端末は、これまでどおり updatedAt で判断する", async () => {
  // 移行のあいだだけ通る経路。ここで 409 にすると、この変更を入れた瞬間に
  // 全端末の 1 回目の公開が失敗する
  await captureConsole(async () => {
    const { sync } = setup({
      initial: { ...SYNCED, ...WITH_TOKEN }, // base はあるが指紋は無い
      handler: github({ remote: plan(REMOTE_STAMP) }),
    });
    const result = await sync.publish(plan(FIXED_ISO));
    assert.equal(result.conflictChecked, true);
  });
});

test("復号できないリモートは「壊れている」扱いにせず、上書きも通さない", async () => {
  /*
   * 「読めない」と「読めたが壊れている」を一緒くたにすると、**合言葉が違って
   * 復号できないだけのリモートを上書きしてしまう** ── 中身が読めないのだから
   * 壊れているかを判断する材料が無く、上書きしてよい根拠も無い。
   * この端末に読めないデータを消すのが一番まずい壊れ方（PR #13 の自己レビューで発見）。
   */
  await captureConsole(async () => {
    const codec = {
      // 復号できない（別の合言葉で暗号化されている）
      decode: async () => {
        throw new DecryptError("wrong-key");
      },
      encode: async (data) => ({ updatedAt: data.updatedAt, ct: "xxx" }),
    };
    const store = createStore(
      memoryBackend({ ...WITH_TOKEN, [BASE_KEY]: JSON.stringify(REMOTE_STAMP) })
    );
    // リモートは base より進んでいる（＝突き合わせが効けば 409 になる条件）
    const ahead = { updatedAt: "2026-08-09T11:00:00.000Z", ct: "yyy" };
    const fetchImpl = fakeFetch((url, init) =>
      init?.method === "PUT"
        ? OK_PUT()
        : jsonResponse(200, { sha: "old-sha", content: toBase64Utf8(JSON.stringify(ahead)) })
    );
    const sync = createSync({ store, fetchImpl, config: { ...CONFIG, codec }, now });

    await assert.rejects(
      sync.publish(plan(FIXED_ISO)),
      (error) => error.status === 409,
      "復号できないリモートを上書きしています"
    );
  });
});
