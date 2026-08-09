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
  node.addEventListener("click", () => onSelect(ev));
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      onSelect(ev);
    }
  });
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
