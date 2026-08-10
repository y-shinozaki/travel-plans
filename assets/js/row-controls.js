/**
 * 一覧の行に置くコントロール。持ち物とお土産の両方が使う。
 *
 * ここに集めてあるのは、**写すと規約の実体が 2 か所に分かれるもの**:
 * 「1 度目で身構え、2 度目で実行する」は `confirm()` を使わないという規約
 * （CLAUDE.md）の実体そのもので、片方だけ直せてしまう状態を作らない。
 *
 * 値は必ず textContent で入れる。innerHTML に入るのは icon() が返す定数と
 * CHECK_MARK だけ（CLAUDE.md の規約）。
 */

import { el } from "./dom.js";
import { icon } from "./icons.js";

/** 文字は textContent、アイコンだけ定数の innerHTML。値は絶対に混ぜない。 */
export function iconButton(cls, iconId, label) {
  const button = el("button", cls);
  button.type = "button";
  button.innerHTML = icon(iconId, "ico--sm");
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

/**
 * 1 度目で身構え、2 度目で実行するボタン。`confirm()` は使わない（CLAUDE.md）。
 * 見た目だけでなく aria-label と title も変える ── 読み上げだけを使う人にも
 * 「次で消える」ことが伝わらないと、身構える意味が無い。
 */
export function armedIconButton({ cls, armedCls, iconId, label, armedLabel, onConfirm }) {
  const button = iconButton(cls, iconId, label);
  let armed = false;
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.className = armedCls;
      button.setAttribute("aria-label", armedLabel);
      button.title = armedLabel;
      return;
    }
    onConfirm();
  });
  return button;
}

/**
 * チェックの印。**icon("i-check") を使わないこと。**
 *
 * controls.css の `.check__box svg path` が stroke-dashoffset を遷移させて
 * チェックを描くアニメーションを持っている。icon() が返すのは
 * `<svg><use href="#i-check"/></svg>` で、path はシャドウツリーの中に入るため
 * このセレクタが届かない ── チェックを入れても印が出ないボックスになる。
 *
 * event-form.js:126 と aman-mock.html:2487 にも同じ生の SVG がある。
 * そちらは今回のフェーズの範囲外だが、**新しく 4 か所目を作らないために**
 * ここへ集約した（設計書 §13 の「小さいもの」）。
 */
export const CHECK_MARK =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="m4.5 12.6 5.2 5.2L19.5 6.6"/></svg>';
