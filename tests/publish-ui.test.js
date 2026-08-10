/**
 * 公開の導線（publish-ui.js）。
 *
 * ここで押さえるのは「押したときに何が起きるか」で、文言の写経ではない。
 * 特に大事なのは 3 つ:
 *
 * 1. 保存したトークンが DOM のどこにも出ないこと（直列化して検索する）
 * 2. 取り込みが明示の操作からしか始まらないこと（黙って下書きを消さない）
 * 3. 直しようのない案内を出さないこと（保存領域に書けない端末に
 *    「取り込んでから公開し直せ」と言わない）
 *
 * store は memoryBackend を差した本物の createStore、sync も本物の createSync。
 * 偽物に差し替えると、キー名や 409 の判定といった繋ぎ目の取り違えを見逃す。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createPublishUI, MESSAGES } from "../assets/js/publish-ui.js";
import { createStore } from "../assets/js/store.js";
import { createSync } from "../assets/js/sync.js";
import { writeToken, hasToken } from "../assets/js/token.js";
import { toBase64Utf8 } from "../assets/js/base64.js";

/* ── 最小の DOM ──────────────────────────────────────────
   publish-ui が実際に触る操作だけを持つ。node --test はファイルごとに
   別プロセスなので、document はモジュール先頭で差し替えてよい。 */

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
    href: "",
    target: "",
    rel: "",
    htmlFor: "",
    title: "",
    children: [],
    attrs: {},
    listeners: {},
    focused: 0,
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    replaceChildren(...kids) {
      node.children = [...kids];
    },
    setAttribute(key, value) {
      node.attrs[key] = String(value);
    },
    removeAttribute(key) {
      delete node.attrs[key];
    },
    addEventListener(type, fn) {
      (node.listeners[type] ??= []).push(fn);
    },
    focus() {
      node.focused++;
    },
  };
  return node;
}

globalThis.document = { createElement: (tag) => makeNode(tag) };

/** 画面に出ている文字列と属性値を全部含む直列化。トークンの捜索に使う。 */
const PROPS = ["className", "id", "type", "value", "href", "target", "rel", "htmlFor", "title"];
function serialize(node) {
  const props = PROPS.filter((k) => node[k]).map((k) => ` ${k}="${node[k]}"`).join("");
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
  const kids = node.children.map(serialize).join("");
  return `<${node.tag}${props}${attrs} hidden="${node.hidden}">${node.innerHTML}${node.textContent}${kids}</${node.tag}>`;
}

/** その要素以下の文字列（ボタンのラベル照合に使う）。 */
const textOf = (node) => node.textContent + node.children.map(textOf).join("");

function walk(node, out = []) {
  out.push(node);
  for (const child of node.children) walk(child, out);
  return out;
}

const buttonsIn = (node) => walk(node).filter((n) => n.tag === "button");
const findButton = (node, label) => buttonsIn(node).find((b) => textOf(b).includes(label)) ?? null;

/** 実 DOM と同じく、disabled な要素はクリックを受け取らない。 */
function fire(node, type = "click") {
  assert.ok(node, "存在しない要素をクリックしようとしています");
  if (node.disabled) return;
  dispatch(node, type);
}

/**
 * disabled を無視してハンドラを直接呼ぶ。
 * 実装側の多重実行ガードを試すときだけ使う ── fire() で 2 回押しても
 * ハーネスの disabled 判定で止まるので、ガードを通っていないのに
 * 「通った」と読めるテストになってしまう。
 */
function dispatch(node, type = "click") {
  for (const fn of node.listeners[type] ?? []) fn();
}

/** マイクロタスクを全部流す（クリックハンドラは async）。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function click(node, type = "click") {
  fire(node, type);
  await settle();
}

/* ── console ──────────────────────────────────────────── */

const LOGS = [];
for (const key of ["warn", "error", "log", "info"]) {
  console[key] = (...args) => LOGS.push(args.map((a) => String(a?.message ?? a)).join(" "));
}
test.beforeEach(() => {
  LOGS.length = 0;
});

/* ── store / sync（sync.test.js と同じ組み立て） ───────── */

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
    calls.push({ url: String(url), init, method: init?.method ?? "GET" });
    return handler(String(url), init, calls.length - 1);
  };
  impl.calls = calls;
  return impl;
}

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CONFIG = { owner: "acme", repo: "trip", branch: "dev", path: "data/plan.json" };
const FIXED_MS = Date.parse("2026-08-09T12:00:00.000Z");
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
const REMOTE_STAMP = "2026-08-09T10:00:00.000Z";
const SYNCED = { [BASE_KEY]: JSON.stringify(REMOTE_STAMP) };
const COMMIT_URL = "https://github.com/acme/trip/commit/abc";

const OK_PUT = () =>
  jsonResponse(201, { content: { sha: "new-sha" }, commit: { html_url: COMMIT_URL } });

/**
 * GET は現物、PUT は put() を返す GitHub。
 * 素のパス（取り込みの読み込み）と Contents API を URL で見分ける ──
 * 同じ remote を、片方は生の JSON、片方は base64 で返す必要がある。
 */
function github({ remote = plan(REMOTE_STAMP), sha = "old-sha", put = OK_PUT } = {}) {
  return (url, init) => {
    if (!url.startsWith("https://api.github.com")) return jsonResponse(200, remote);
    return init.method === "PUT"
      ? put()
      : jsonResponse(200, { sha, content: toBase64Utf8(JSON.stringify(remote)) });
  };
}

const TOKEN = "ghp_liveSecretValue0123456789";

function mount({
  initial = {},
  handler = github(),
  token = null,
  source = "use-remote",
  data = plan(REMOTE_STAMP),
  backend = null,
} = {}) {
  const be = backend ?? memoryBackend(initial);
  const store = createStore(be);
  if (token) writeToken(store, token);
  const fetchImpl = fakeFetch(handler);
  const sync = createSync({ store, fetchImpl, config: CONFIG, now });

  const els = {
    controls: makeNode("div"),
    panel: makeNode("div"),
    status: makeNode("div"),
    bar: makeNode("div"),
  };
  els.panel.id = "pub-panel";

  let current = data;
  const adopted = [];
  const ui = createPublishUI({
    els,
    store,
    sync,
    getData: () => current,
    onAdopt: (next) => {
      current = next;
      adopted.push(next);
    },
  });
  ui.start(source);

  return {
    ui,
    els,
    store,
    sync,
    fetchImpl,
    adopted,
    raw: (k) => be._dump()[k],
    dom: () => [els.controls, els.panel, els.status, els.bar].map(serialize).join(""),
    tokenField: () => walk(els.panel).find((n) => n.id === "pub-token"),
    statusText: () => textOf(els.status),
    barText: () => textOf(els.bar),
  };
}

/* ══════════════════════════════════════════════════════════
   起動直後の DOM 挿入（start() を呼ぶ前）

   sync.load() が投げる端末（リモートが壊れている、復号できない…）では
   schedule.js は publishUI.start() まで到達しない。events.json の手編集を
   廃止した以上、そこで公開ボタンとトークン設定が画面に無いと復旧手段が
   ゼロになる（Task 5 レビューの Critical）。createPublishUI() 自身が
   これらを組み立てて DOM へ挿入することを確かめる。
   ══════════════════════════════════════════════════════════ */

test("start() を呼ぶ前に、公開の導線が DOM に入っている", () => {
  const els = {
    controls: makeNode("div"),
    panel: makeNode("div"),
    status: makeNode("div"),
    bar: makeNode("div"),
  };
  els.panel.id = "pub-panel";
  const store = createStore(memoryBackend({ "tp:gh-token": TOKEN }));
  const sync = createSync({
    store,
    fetchImpl: fakeFetch(() => jsonResponse(200, plan(REMOTE_STAMP))),
    config: CONFIG,
    now,
  });

  createPublishUI({
    els,
    store,
    sync,
    getData: () => plan(REMOTE_STAMP),
    onAdopt: () => {},
  });
  // ui.start(source) を意図的に呼んでいない

  // findButton は部分一致なので "公開用トークンを設定"（トークン未設定時のラベル）にも
  // マッチしてしまう。ここではトークンを先に入れてあるので「公開」ボタンの厳密一致で見る
  // ── そうしないと、このテストは「本当に公開ボタンが出ている」ことではなく
  // 「何か "公開" を含むボタンがある」ことしか確かめない
  assert.equal(
    buttonsIn(els.controls).some((b) => textOf(b) === "公開"),
    true,
    "start() を呼ぶ前に公開ボタンがありません"
  );
  assert.equal(
    els.panel.children.length > 0,
    true,
    "start() を呼ぶ前にトークン設定パネルが組み立てられていません"
  );
  // 早く組み立てても、トークンを画面に出す約束は変わらない
  const dom = [els.controls, els.panel, els.status, els.bar].map(serialize).join("");
  assert.equal(dom.includes(TOKEN), false, "start() を呼ぶ前の DOM にトークンが出ています");
});

/* ══════════════════════════════════════════════════════════
   トークン設定
   ══════════════════════════════════════════════════════════ */

test("トークン未設定なら公開ボタンを置かず、設定への導線だけ出す", () => {
  const h = mount();
  assert.equal(findButton(h.els.controls, "公開用トークンを設定") !== null, true);
  assert.equal(
    buttonsIn(h.els.controls).some((b) => textOf(b) === "公開"),
    false,
    "トークンが無いのに公開ボタンがあります"
  );
});

test("トークンを保存すると公開ボタンが出て、削除すると消える", () => {
  const h = mount();
  const settings = findButton(h.els.controls, "公開用トークンを設定");

  fire(settings);
  assert.equal(h.els.panel.hidden, false, "設定パネルが開いていません");
  assert.equal(h.tokenField().type, "password");
  assert.equal(h.tokenField().focused, 1, "入力欄にフォーカスが移っていません");

  h.tokenField().value = TOKEN;
  fire(findButton(h.els.panel, "保存"));

  assert.equal(hasToken(h.store), true);
  assert.equal(findButton(h.els.controls, "公開") !== null, true, "公開ボタンが出ていません");
  assert.equal(textOf(h.els.panel).includes("設定済み"), true);

  // 削除は 2 度押し。1 度目では消えない
  const del = findButton(h.els.panel, "削除");
  fire(del);
  assert.equal(hasToken(h.store), true, "1 度目で消えています");
  assert.equal(textOf(del).includes("もう一度"), true);

  fire(del);
  assert.equal(hasToken(h.store), false);
  assert.equal(
    buttonsIn(h.els.controls).some((b) => textOf(b).startsWith("公開（") || textOf(b) === "公開"),
    false,
    "削除したのに公開ボタンが残っています"
  );
});

test("保存したトークンは DOM のどこにも現れない", () => {
  const h = mount();
  fire(findButton(h.els.controls, "公開用トークンを設定"));
  h.tokenField().value = TOKEN;
  fire(findButton(h.els.panel, "保存"));

  // 実際に保存されていることを先に確かめる（何も保存していなければ
  // 「DOM に無い」は当たり前で、検査として意味がない）
  assert.equal(h.raw("tp:gh-token"), TOKEN);

  assert.equal(h.tokenField().value, "", "入力欄に打った値が残っています");
  assert.equal(h.dom().includes(TOKEN), false, "DOM にトークンが出ています");
  // 一部でも出ていないこと（伏せ字や先頭数文字も出さない約束）
  assert.equal(h.dom().includes(TOKEN.slice(0, 10)), false);

  // 閉じて開き直しても表示し直さない（1 回目のクリックは「閉じる」）
  const settings = findButton(h.els.controls, "トークン設定");
  fire(settings);
  assert.equal(h.els.panel.hidden, true, "前提: ここで閉じているはず");
  fire(settings);
  assert.equal(h.els.panel.hidden, false, "前提: ここで開いているはず");

  assert.equal(h.tokenField().value, "");
  assert.equal(h.dom().includes(TOKEN), false, "開き直すとトークンが出ています");
  assert.equal(LOGS.join("\n").includes(TOKEN), false, "console にトークンが出ています");
});

test("保存済みのトークンを持って開いた画面にも、トークンは出ない", () => {
  // ページを読み込み直した状態。入力欄は空で始まり、開いても空のまま
  const h = mount({ token: TOKEN });
  assert.equal(h.raw("tp:gh-token"), TOKEN, "前提: 保存されていること");
  assert.equal(h.dom().includes(TOKEN), false, "起動直後の DOM にトークンが出ています");

  fire(findButton(h.els.controls, "トークン設定"));
  assert.equal(h.els.panel.hidden, false);
  assert.equal(h.tokenField().value, "");
  assert.equal(h.dom().includes(TOKEN), false, "設定パネルにトークンが出ています");
  assert.equal(h.dom().includes(TOKEN.slice(0, 8)), false);
});

test("保存せずにパネルを閉じても、打ちかけの値は残らない", () => {
  const h = mount();
  const settings = findButton(h.els.controls, "公開用トークンを設定");
  fire(settings);
  h.tokenField().value = TOKEN;

  fire(settings); // 保存せずに閉じる
  assert.equal(h.els.panel.hidden, true);
  assert.equal(h.tokenField().value, "", "閉じても打ちかけの値が残っています");
  assert.equal(h.dom().includes(TOKEN), false);
});

test("空のまま保存を押しても、設定済みのトークンを消さない", () => {
  const h = mount({ token: TOKEN });
  fire(findButton(h.els.controls, "トークン設定"));
  h.tokenField().value = "   ";
  fire(findButton(h.els.panel, "保存"));

  assert.equal(hasToken(h.store), true, "保存を押したらトークンが消えました");
  assert.equal(textOf(h.els.panel).includes(MESSAGES.tokenEmpty), true);
});

test("保存に失敗してもトークンを画面に出さない", () => {
  const backend = memoryBackend();
  backend.setItem = () => {
    throw new Error("quota");
  };
  const h = mount({ backend });
  fire(findButton(h.els.controls, "公開用トークンを設定"));
  h.tokenField().value = TOKEN;
  fire(findButton(h.els.panel, "保存"));

  assert.equal(textOf(h.els.panel).includes("保存できませんでした"), true);
  assert.equal(h.dom().includes(TOKEN), false);
  assert.equal(LOGS.join("\n").includes(TOKEN), false);
});

/* ══════════════════════════════════════════════════════════
   公開
   ══════════════════════════════════════════════════════════ */

test("検証に通らないデータでは通信しない", async () => {
  const h = mount({ initial: SYNCED, token: TOKEN, data: BROKEN });
  await click(findButton(h.els.controls, "公開"));

  assert.equal(h.fetchImpl.calls.length, 0, "検証に落ちたのに API を叩いています");
  assert.equal(h.statusText().includes("この内容では公開できません"), true);
  assert.equal(h.els.status.className.includes("pubstat--error"), true);
});

test("公開に成功すると文言とコミットへのリンクを出す", async () => {
  const h = mount({ initial: SYNCED, token: TOKEN });
  await click(findButton(h.els.controls, "公開"));

  assert.equal(h.fetchImpl.calls.map((c) => c.method).join(","), "GET,PUT");
  assert.equal(h.statusText().includes(MESSAGES.published), true);
  const link = walk(h.els.status).find((n) => n.tag === "a");
  assert.equal(link.href, COMMIT_URL);
  assert.equal(link.target, "_blank");
  assert.equal(h.els.status.className.includes("pubstat--ok"), true);
  // 突き合わせは効いている。省略の警告を出さない
  assert.equal(h.statusText().includes(MESSAGES.conflictCheckSkipped), false);
});

test("突き合わせを省いて公開したことを画面に出す", async () => {
  // リモートの updatedAt が読めないと sync は検査を飛ばして公開する。
  // 唯一ガードが効いていない場面なので、成功の陰に隠さない
  const h = mount({
    initial: SYNCED,
    token: TOKEN,
    handler: (url, init) =>
      init.method === "PUT"
        ? OK_PUT()
        : jsonResponse(200, { sha: "old", content: toBase64Utf8("こわれている") }),
  });
  await click(findButton(h.els.controls, "公開"));

  assert.equal(h.statusText().includes(MESSAGES.published), true);
  assert.equal(h.statusText().includes(MESSAGES.conflictCheckSkipped), true);
  assert.equal(h.els.status.className.includes("pubstat--warn"), true);
});

test("409 は文言をそのまま出し、取り込みボタンを添える", async () => {
  const h = mount({
    initial: SYNCED,
    token: TOKEN,
    handler: github({ remote: plan("2026-08-09T11:30:00.000Z") }),
  });
  await click(findButton(h.els.controls, "公開"));

  assert.equal(h.statusText().includes("取り込んでから公開し直してください"), true);
  const adopt = findButton(h.els.status, "取り込む");
  assert.equal(adopt !== null, true, "取り込みボタンがありません");

  // 1 度目では取り込まない（GET 1 回のまま）
  await click(adopt);
  assert.equal(h.fetchImpl.calls.length, 1);
  assert.equal(h.adopted.length, 0);
});

test("409 のあと 2 度押しで取り込むと、下書きがリモートに入れ替わる", async () => {
  const remote = plan("2026-08-09T11:30:00.000Z", [ev({ title: "リモートの昼食" })]);
  const h = mount({
    initial: { [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")), ...SYNCED },
    token: TOKEN,
    handler: github({ remote }),
  });
  await click(findButton(h.els.controls, "公開"));

  const adopt = findButton(h.els.status, "取り込む");
  await click(adopt); // 身構える
  await click(adopt); // 実行

  assert.deepEqual(h.adopted, [remote], "取り込んだデータが画面へ渡っていません");
  assert.deepEqual(JSON.parse(h.raw(DRAFT_KEY)), remote);
  assert.equal(JSON.parse(h.raw(BASE_KEY)), "2026-08-09T11:30:00.000Z");
  assert.equal(h.statusText().includes(MESSAGES.adopted), true);
});

test("保存領域に書けない端末の 409 には、取り込みボタンを出さない", async () => {
  // base を残せない端末では公開が必ず 409 になり、取り込みも同じ理由で失敗する。
  // 「取り込んでから公開し直してください」だけを出すと、押しても直らない
  // ボタンを押させ続けることになる
  //
  // トークンは書けないので直接 readText を差し替える代わりに、getItem 側に
  // 先に入れておく（前のセッションで保存済みだが、以後は書けなくなった端末）。
  // createPublishUI() は構築時に一度だけ hasToken(store) を読むので、
  // getItem の差し替えは mount() より前に済ませること ── あとから差し替えても
  // 構築済みの controls は再読みしない（本物のページでは、トークンは
  // 前のセッションで保存され、読み込み時には既に読める値として store にある）。
  const backend = memoryBackend();
  backend.getItem = (k) => (k === "tp:gh-token" ? TOKEN : null);
  backend.setItem = () => {
    throw new Error("quota");
  };
  const h = mount({ backend, handler: github(), source: "use-local" });

  await click(findButton(h.els.controls, "公開"));

  assert.equal(h.statusText().includes(MESSAGES.cannotPersist), true);
  assert.equal(findButton(h.els.status, "取り込む"), null, "効かない取り込みボタンが出ています");
  // 409 の定型文（取り込んでから公開し直す）はここでは出さない。
  // この端末では取り込みが成立しないので、案内すると押しても直らない道へ誘導する
  assert.equal(
    h.statusText().includes("取り込んでから公開し直してください"),
    false,
    "できない手順を案内しています"
  );
  // 生の文言は console には残す（原因を追えなくしない）
  assert.equal(LOGS.join("\n").includes("リモートが更新されています"), true);
});

test("取り込んだあと画面の更新に失敗しても「取り込めなかった」とは言わない", async () => {
  // 画面の更新の成否は schedule.js の safeDraw が自分の文言で伝える。
  // ここが独自に文言を出すと、実運用（safeDraw は例外を飲む）では届かず、
  // 届く場合は 2 つの文言が矛盾する
  const remote = plan("2026-08-09T11:30:00.000Z", [ev({ title: "リモートの昼食" })]);
  const be = memoryBackend({
    [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")),
    ...SYNCED,
  });
  const store = createStore(be);
  const els = {
    controls: makeNode("div"),
    panel: makeNode("div"),
    status: makeNode("div"),
    bar: makeNode("div"),
  };
  els.panel.id = "pub-panel";
  const ui = createPublishUI({
    els,
    store,
    sync: createSync({
      store,
      fetchImpl: fakeFetch(() => jsonResponse(200, remote)),
      config: CONFIG,
      now,
    }),
    getData: () => plan(REMOTE_STAMP),
    onAdopt: () => {
      throw new Error("描き直せません");
    },
  });
  ui.start("remote-is-newer");

  const adopt = findButton(els.bar, "取り込む");
  await click(adopt);
  await click(adopt);

  // 下書きはもう入れ替わっている。「取り込めませんでした」は嘘になる
  assert.deepEqual(JSON.parse(be._dump()[DRAFT_KEY]), remote);
  assert.equal(textOf(els.status).includes(MESSAGES.adoptFailed), false);
  assert.equal(textOf(els.status).includes(MESSAGES.adopted), true);
  // 黙って消さない。unhandled rejection にもしない
  assert.equal(LOGS.join("\n").includes("描き直せません"), true);
});

test("PUT のあとに保存できなかったときは「公開はできた」と伝える", async () => {
  // sync.publish は PUT の成功後にしか store へ書かない。
  // ここで StoreWriteError が来たということは、公開自体は済んでいる
  const map = new Map(
    Object.entries({
      "tp:gh-token": TOKEN,
      [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")),
      ...SYNCED,
    })
  );
  const backend = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k) => {
      if (k === DRAFT_KEY || k === BASE_KEY) throw new Error("quota");
      map.set(k, "x");
    },
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
  const h = mount({ backend, handler: github() });
  assert.equal(h.ui.isDirty(), true, "前提: 未公開の変更がある状態");

  await click(findButton(h.els.controls, "公開"));

  assert.equal(h.fetchImpl.calls.at(-1).method, "PUT", "PUT まで進んでいません");
  assert.equal(h.statusText().includes(MESSAGES.publishedNotRecorded), true);
  assert.equal(h.statusText().includes(MESSAGES.cannotPersist), true);
  // ボタンは「未公開の変更あり」のまま。控えを書けていないので、この端末の
  // ストアから見れば実際にまだ揃っていない。UI が独自に下ろすと、
  // ストアの言い分と画面が食い違う（説明は文言のほうが受け持つ）
  assert.equal(h.ui.isDirty(), true);
});

test("バーを無視して公開して 409 になっても、取り込みボタンは 1 つだけ", async () => {
  const h = mount({
    source: "remote-is-newer",
    token: TOKEN,
    initial: { [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")), ...SYNCED },
    handler: github({ remote: plan("2026-08-09T11:30:00.000Z") }),
  });
  assert.equal(findButton(h.els.bar, "取り込む") !== null, true, "前提: バーが出ている");

  await click(findButton(h.els.controls, "公開"));

  const adoptButtons = [...buttonsIn(h.els.bar), ...buttonsIn(h.els.status)].filter((b) =>
    textOf(b).includes("取り込む")
  );
  assert.equal(adoptButtons.length, 1, "取り込みボタンが 2 つ出ています");
  // 残すのは失敗の理由の隣。バーの案内はこの失敗に追い越されている
  assert.equal(h.els.bar.hidden, true);
  assert.equal(findButton(h.els.status, "取り込む") !== null, true);
});

test("conflictChecked が返らなくなったら、警告は消えるのではなく出る", async () => {
  // === false で見ていると、この項目が将来落ちたときに「突き合わせを省いた」
  // 警告が黙って出なくなる。フェイルオープンではなくフェイルクローズドに
  const els = {
    controls: makeNode("div"),
    panel: makeNode("div"),
    status: makeNode("div"),
    bar: makeNode("div"),
  };
  els.panel.id = "pub-panel";
  const store = createStore(memoryBackend({ "tp:gh-token": TOKEN }));
  const ui = createPublishUI({
    els,
    store,
    sync: {
      publish: async () => ({ commitUrl: COMMIT_URL }), // conflictChecked が無い
      adoptRemote: async () => plan(REMOTE_STAMP),
      hasUnpublishedChanges: () => false,
    },
    getData: () => plan(REMOTE_STAMP),
    onAdopt: () => {},
  });
  ui.start("use-remote");

  await click(findButton(els.controls, "公開"));
  assert.equal(textOf(els.status).includes(MESSAGES.conflictCheckSkipped), true);
});

test("401 は GitHubError の文言をそのまま出す", async () => {
  const h = mount({
    initial: SYNCED,
    token: TOKEN,
    handler: () => jsonResponse(401, { message: "Bad credentials" }),
  });
  await click(findButton(h.els.controls, "公開"));

  assert.equal(h.statusText().includes("トークンが無効です。設定し直してください"), true);
  assert.equal(findButton(h.els.status, "取り込む"), null, "409 でないのに取り込みが出ています");
  assert.equal(h.dom().includes(TOKEN), false);
});

test("公開の最中は公開ボタンを押せない（二重送信を止める）", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = mount({
    initial: SYNCED,
    token: TOKEN,
    handler: async (url, init) => {
      await gate;
      return init.method === "PUT" ? OK_PUT() : github()(url, init);
    },
  });

  const button = findButton(h.els.controls, "公開");
  await click(button);
  assert.equal(button.disabled, true, "公開中にボタンが押せます");
  assert.equal(textOf(button).includes("公開中"), true);

  // disabled 越しではなくハンドラを直接呼ぶ。実装側の `if (busy) return` を
  // 実際に通す（ハーネスの disabled 判定で止めると、ガードが無くても通る）
  dispatch(button);
  dispatch(button);
  await settle();
  assert.equal(
    h.fetchImpl.calls.length,
    1,
    "busy ガードを抜けて 2 本目の公開が始まっています"
  );

  release();
  await settle();
  assert.equal(h.fetchImpl.calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(button.disabled, false);
});

test("取り込みの最中は公開ボタンを「公開中…」にしない", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const remote = plan("2026-08-09T11:30:00.000Z");
  const h = mount({
    source: "remote-is-newer",
    token: TOKEN,
    initial: { [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")), ...SYNCED },
    handler: async () => {
      await gate;
      return jsonResponse(200, remote);
    },
  });

  const adopt = findButton(h.els.bar, "取り込む");
  await click(adopt); // 身構える
  await click(adopt); // 実行（gate で止まる）

  const publish = findButton(h.els.controls, "公開");
  assert.equal(publish.disabled, true, "取り込み中に公開できます");
  assert.equal(textOf(publish).includes("公開中"), false, "走っていない処理を名乗っています");
  // バーのボタンも止める。押しても何も起きないボタンを残さない
  assert.equal(adopt.disabled, true, "取り込み中もバーのボタンが押せます");

  release();
  await settle();
  assert.equal(h.els.bar.hidden, true);
});

/* ══════════════════════════════════════════════════════════
   起動時の案内（source ごと）
   ══════════════════════════════════════════════════════════ */

test("use-remote では何も出さない", () => {
  const h = mount({ source: "use-remote", token: TOKEN });
  assert.equal(h.els.bar.hidden, true);
  assert.equal(h.els.status.hidden, true);
  assert.equal(h.ui.isDirty(), false);
  assert.equal(textOf(findButton(h.els.controls, "公開")), "公開");
});

/* 「未公開の変更あり」は source ではなくストアの中身で決まる。
   source を使うと、一度も編集せずページを 2 回開いただけの端末
   （1 回目の use-remote が下書きと base を書くので 2 回目は use-local）が
   永久に「未公開の変更あり」を出し、指標として何も言わなくなる。 */

test("下書きと base が揃っていれば、use-local でも未公開の変更は出さない", () => {
  // ページを 2 回開いただけの端末。storeAdopted が書いた下書きと base は
  // 同じ時刻を指している
  const h = mount({
    source: "use-local",
    token: TOKEN,
    initial: {
      [DRAFT_KEY]: JSON.stringify(plan(REMOTE_STAMP)),
      [BASE_KEY]: JSON.stringify(REMOTE_STAMP),
    },
  });
  assert.equal(h.ui.isDirty(), false, "編集していない端末に未公開の変更が出ています");
  assert.equal(textOf(findButton(h.els.controls, "公開")), "公開");
});

test("下書きが base より進んでいれば、未公開の変更として出す", () => {
  const h = mount({
    source: "use-local",
    token: TOKEN,
    initial: {
      [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")),
      [BASE_KEY]: JSON.stringify(REMOTE_STAMP),
    },
  });
  assert.equal(h.ui.isDirty(), true);
  assert.equal(textOf(findButton(h.els.controls, "公開")).includes("未公開の変更あり"), true);
});

test("offline でも未公開の変更の有無は出せる（リモートを見ずに分かる）", () => {
  const synced = mount({
    source: "offline",
    token: TOKEN,
    initial: {
      [DRAFT_KEY]: JSON.stringify(plan(REMOTE_STAMP)),
      [BASE_KEY]: JSON.stringify(REMOTE_STAMP),
    },
  });
  assert.equal(synced.ui.isDirty(), false);

  const edited = mount({
    source: "offline",
    token: TOKEN,
    initial: {
      [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")),
      [BASE_KEY]: JSON.stringify(REMOTE_STAMP),
    },
  });
  assert.equal(edited.ui.isDirty(), true);
});

test("下書きが無ければ未公開の変更も無い", () => {
  const h = mount({ source: "use-remote", token: TOKEN, initial: {} });
  assert.equal(h.ui.isDirty(), false);
});

test("保存すると公開ボタンの文言が変わる", () => {
  const h = mount({
    source: "use-remote",
    token: TOKEN,
    initial: {
      [DRAFT_KEY]: JSON.stringify(plan(REMOTE_STAMP)),
      [BASE_KEY]: JSON.stringify(REMOTE_STAMP),
    },
  });
  assert.equal(h.ui.isDirty(), false);

  // 実際に保存する（下書きの updatedAt が進む）。UI 側のフラグは触らない
  h.sync.saveLocal(plan("2020-01-01T00:00:00.000Z"));
  h.ui.refreshDirty();

  assert.equal(textOf(findButton(h.els.controls, "公開")).includes("未公開の変更あり"), true);
});

test("remote-is-newer ではバーを出して選ばせる。黙って取り込まない", async () => {
  const h = mount({
    source: "remote-is-newer",
    token: TOKEN,
    initial: { [DRAFT_KEY]: JSON.stringify(plan("2026-08-09T11:00:00.000Z")), ...SYNCED },
  });

  assert.equal(h.els.bar.hidden, false);
  assert.equal(h.barText().includes("別の端末で新しい旅程が公開されています"), true);
  assert.equal(h.barText().includes("未公開の変更は失われます"), true);
  assert.equal(findButton(h.els.bar, "取り込む") !== null, true);
  assert.equal(findButton(h.els.bar, "自分の変更を残す") !== null, true);
  // 出しただけで通信も上書きもしていない
  assert.equal(h.fetchImpl.calls.length, 0);
  assert.equal(h.adopted.length, 0);
  assert.equal(h.ui.isDirty(), true);

  await settle();
  assert.equal(h.fetchImpl.calls.length, 0, "放っておいたら取り込まれました");
});

test("バーの取り込みも 2 度押し。1 度目では下書きを消さない", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z", [ev({ title: "手元で直した昼食" })]);
  const remote = plan("2026-08-09T11:30:00.000Z", [ev({ title: "リモートの昼食" })]);
  const h = mount({
    source: "remote-is-newer",
    token: TOKEN,
    initial: { [DRAFT_KEY]: JSON.stringify(draft), ...SYNCED },
    handler: () => jsonResponse(200, remote),
  });

  const adopt = findButton(h.els.bar, "取り込む");
  await click(adopt);
  assert.equal(h.fetchImpl.calls.length, 0, "1 度目で取りに行っています");
  assert.deepEqual(JSON.parse(h.raw(DRAFT_KEY)), draft);

  await click(adopt);
  assert.deepEqual(h.adopted, [remote]);
  assert.deepEqual(JSON.parse(h.raw(DRAFT_KEY)), remote);
  assert.equal(h.els.bar.hidden, true, "取り込んだのにバーが残っています");
  assert.equal(h.ui.isDirty(), false);
  // 押したボタンは文書から消えている。戻し先が無いとフォーカスは <body> へ落ちる
  assert.equal(
    h.els.controls.children[0].focused,
    1,
    "取り込んだあとフォーカスの戻し先がありません"
  );
});

test("「自分の変更を残す」は何も取り込まず、次の公開で起きることを伝える", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z");
  const h = mount({
    source: "remote-is-newer",
    token: TOKEN,
    initial: { [DRAFT_KEY]: JSON.stringify(draft), ...SYNCED },
  });

  await click(findButton(h.els.bar, "自分の変更を残す"));

  assert.equal(h.els.bar.hidden, true);
  assert.equal(h.fetchImpl.calls.length, 0);
  assert.deepEqual(JSON.parse(h.raw(DRAFT_KEY)), draft, "下書きが書き換わっています");
  assert.equal(h.statusText().includes(MESSAGES.keptLocal), true);
  assert.equal(h.ui.isDirty(), true);
});

test("取り込みに失敗したら理由を出し、下書きを残す", async () => {
  const draft = plan("2026-08-09T11:00:00.000Z");
  const h = mount({
    source: "remote-is-newer",
    token: TOKEN,
    initial: { [DRAFT_KEY]: JSON.stringify(draft), ...SYNCED },
    handler: () => {
      throw new TypeError("Failed to fetch");
    },
  });

  const adopt = findButton(h.els.bar, "取り込む");
  await click(adopt);
  await click(adopt);

  assert.equal(h.statusText().includes(MESSAGES.adoptFailed), true);
  assert.equal(h.statusText().includes("取得できませんでした"), true);
  assert.deepEqual(JSON.parse(h.raw(DRAFT_KEY)), draft);
  assert.equal(h.adopted.length, 0);
});

test("offline は確認できなかったことだけ伝え、機能を落とさない", () => {
  const h = mount({ source: "offline", token: TOKEN });

  assert.equal(h.els.bar.hidden, false);
  assert.equal(h.barText().includes(MESSAGES.offline), true);
  // 公開も設定も生きている
  const publish = findButton(h.els.controls, "公開");
  assert.equal(publish.disabled, false, "オフラインで公開ボタンが無効になっています");
  assert.equal(findButton(h.els.controls, "トークン設定") !== null, true);

  fire(findButton(h.els.bar, "閉じる"));
  assert.equal(h.els.bar.hidden, true);
});

test("offline でトークンが無くても、設定への導線は出る", () => {
  const h = mount({ source: "offline" });
  assert.equal(findButton(h.els.controls, "公開用トークンを設定") !== null, true);
  assert.equal(h.els.bar.hidden, false);
});

/* ══════════════════════════════════════════════════════════
   後始末
   ══════════════════════════════════════════════════════════ */

test("書き込み可否の判定は保存領域にゴミを残さない", async () => {
  const h = mount({
    initial: SYNCED,
    token: TOKEN,
    handler: github({ remote: plan("2026-08-09T11:30:00.000Z") }),
  });
  await click(findButton(h.els.controls, "公開")); // 409 → canPersist() が走る

  assert.equal(h.statusText().includes("取り込んでから公開し直してください"), true);
  assert.equal(h.raw("tp:write-probe"), undefined, "判定用のキーが残っています");
});
