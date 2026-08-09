/**
 * 公開用トークンの置き場所。store.js の上に載るだけの薄い層。
 *
 * ここに閉じ込めておく理由は 2 つある。
 *
 * 1. キー名（`tp:gh-token`）を 1 か所にする。呼び出し側が生のキーを知っていると、
 *    「消したつもりで消えていない」書き間違いが起こりうる
 * 2. トークンの出口を 1 か所にする。読んだ値は github.js の Authorization ヘッダ
 *    にしか渡さない。ログにも DOM にも例外文にも出さないこと
 *
 * store.read / store.write ではなく readText / writeText を使うのは 2 のため。
 * read は JSON.parse を通すので、キーに JSON でない値が入っていると
 * SyntaxError の文言に中身の先頭が埋め込まれ（`Unexpected token 'g', "ghp_liveSe"...`）、
 * それが console.warn へ出る。トークンを平文で書き込んでおけばパースは起こらない。
 * localStorage は元々平文なので、JSON で包んでも秘匿性は 1 ミリも変わらない。
 *
 * 設計書 §5.4 に対応。
 */

const KEY = "gh-token";

/**
 * 使えるトークンだけを返す（無ければ null）。
 * 空文字や空白だけの値は「無い」と同じ扱いにする。createGitHub は
 * 空のトークンを拒むので、ここで通すと「設定済みなのに必ず失敗する」状態になる。
 */
export function readToken(store) {
  const value = store.readText(KEY);
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

/**
 * 保存する。前後の空白は落とす（貼り付けで末尾に改行が付くと、
 * そのまま Authorization ヘッダに入って fetch が投げる）。
 *
 * 空になったものは保存せず削除する。空文字を持たせても hasToken は false を
 * 返すので、キーだけが残って紛らわしい。
 */
export function writeToken(store, value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    clearToken(store);
    return;
  }
  store.writeText(KEY, trimmed);
}

export function clearToken(store) {
  store.remove(KEY);
}

/** 公開ボタンを出すかどうかの判断に使う。store.has ではなく中身で見る。 */
export function hasToken(store) {
  return readToken(store) !== null;
}
