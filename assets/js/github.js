/**
 * GitHub Contents API の呼び出しだけを担う層。
 *
 * fetchImpl を差し替えられるようにしてあるのは、応答パターン
 * （404 / 409 / 401 / 403 / 通信断）を Node で全部通すため。
 *
 * エラーは status と「人が読んで次に何をすればいいか分かる文言」を持たせて投げる。
 * 画面にそのまま出す前提なので、英語の生メッセージを素通しさせない。
 */
import { toBase64Utf8, fromBase64Utf8 } from "./base64.js";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export class GitHubError extends Error {
  constructor(status, message, cause) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.cause = cause;
  }
}

/**
 * 「別の端末が先に公開した」を伝える文言。
 *
 * サーバーが 409 を返した場合（下の explain）と、sync.js が PUT の前の突き合わせで
 * 自分から 409 を投げる場合の両方で使う。利用者から見れば同じ出来事で、
 * 次にすることも同じ（取り込んでから公開し直す）。
 * 以前は sync.js 側に同じ文字列を書き写していて、片方だけ直しても誰も気付かなかった。
 */
export const CONFLICT_MESSAGE = "リモートが更新されています。取り込んでから公開し直してください";

function explain(status, body) {
  const detail = body?.message ? `（${body.message}）` : "";
  switch (status) {
    case 401:
      return `トークンが無効です。設定し直してください${detail}`;
    case 403:
      return `権限が足りません。トークンに Contents の書き込み権限があるか確認してください${detail}`;
    case 409:
      return `${CONFLICT_MESSAGE}${detail}`;
    case 404:
      // getFile の 404 は null を返す経路で処理するため、ここに来るのは putFile だけ。
      return `対象が見つかりません。パスとブランチ名を確認してください${detail}`;
    case 422:
      return `内容を受け付けてもらえませんでした${detail}`;
    default:
      return `GitHub への通信に失敗しました（HTTP ${status}）${detail}`;
  }
}

export function createGitHub({ owner, repo, branch, token, fetchImpl = fetch }) {
  // status: 0 は「HTTP のやり取りに至っていない」の意。通信断と同じ扱いにしておくと、
  // 呼び出し側は常に error.status を見るだけでよくなる。
  if (!token) throw new GitHubError(0, "トークンがありません。設定してください");

  const base = `${API}/repos/${owner}/${repo}/contents/`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };

  async function call(url, init) {
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      throw new GitHubError(0, "GitHub に接続できませんでした。通信状況を確認してください", error);
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      // 本文が JSON でないことがある。status だけで判断する
    }
    return { response, body };
  }

  async function getFile(path) {
    const url = `${base}${path}?ref=${encodeURIComponent(branch)}`;
    const { response, body } = await call(url, { method: "GET", headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new GitHubError(response.status, explain(response.status, body));
    // 2xx でも本文が JSON として読めない、または想定の形でないことがある
    // （プロキシの介在など）。ここで確かめないと下の参照が素の TypeError を投げ、
    // 「生のエラーを画面に出さない」というこのモジュールの方針が破れる。
    if (!body || typeof body.sha !== "string" || typeof body.content !== "string") {
      throw new GitHubError(response.status, "GitHub から予期しない応答が返りました");
    }
    // Contents API は base64 に 60 文字ごとの改行を挟むことがあるが、
    // atob は仕様上 ASCII 空白を読み飛ばすので、ここで除去する必要はない。
    return { sha: body.sha, text: fromBase64Utf8(body.content) };
  }

  async function putFile({ path, text, sha, message }) {
    const payload = { message, content: toBase64Utf8(text), branch };
    if (sha) payload.sha = sha;

    const { response, body } = await call(`${base}${path}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new GitHubError(response.status, explain(response.status, body));
    if (!body?.content?.sha || !body?.commit?.html_url) {
      throw new GitHubError(response.status, "GitHub から予期しない応答が返りました");
    }
    return { sha: body.content.sha, commitUrl: body.commit.html_url };
  }

  return { getFile, putFile };
}
