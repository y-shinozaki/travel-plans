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
  // Contents API は 60 文字ごとに改行を挟むことがある。
  // これを支えているのは atob が ASCII 空白を読み飛ばす仕様なので、
  // このテストは github.js のコードではなく「依存している前提」を守っている。
  // 厳格なデコーダに差し替えたときにここで気づける。
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
  assert.equal(init.headers.Accept, "application/vnd.github+json");
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
  assert.throws(
    () => createGitHub({ ...CONF, token: "", fetchImpl: impl }),
    (e) => e instanceof GitHubError && e.status === 0 && /トークン/.test(e.message)
  );
  assert.equal(impl.calls.length, 0);
});

test("getFile は成功応答の本文が壊れていると GitHubError を投げる", async () => {
  // 2xx でも本文が JSON として読めないことがある（プロキシの介在など）。
  // call() はそれを body = null として握りつぶすので、getFile 側で形を確認しないと
  // body.sha の参照で素の TypeError が画面に出てしまう。
  const impl = fakeFetch(() => new Response("not json", { status: 200 }));
  await assert.rejects(
    () => createGitHub({ ...CONF, fetchImpl: impl }).getFile("p"),
    (e) => e instanceof GitHubError && /予期しない/.test(e.message)
  );
});

test("putFile は成功応答の本文が壊れていると GitHubError を投げる", async () => {
  const impl = fakeFetch(() => new Response("not json", { status: 200 }));
  await assert.rejects(
    () =>
      createGitHub({ ...CONF, fetchImpl: impl }).putFile({ path: "p", text: "x", sha: null, message: "m" }),
    (e) => e instanceof GitHubError && /予期しない/.test(e.message)
  );
});

test("putFile の 404 はパスとブランチの確認を促す", async () => {
  // getFile の 404 は null を返す経路で処理されるため explain() には来ない。
  // ここに来るのは putFile だけ。
  const impl = fakeFetch(() => json(404, { message: "Not Found" }));
  await assert.rejects(
    () =>
      createGitHub({ ...CONF, fetchImpl: impl }).putFile({ path: "p", text: "x", sha: null, message: "m" }),
    (e) => e instanceof GitHubError && e.status === 404 && /パス|ブランチ/.test(e.message)
  );
});
