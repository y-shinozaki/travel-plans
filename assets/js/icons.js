/**
 * インライン SVG スプライト。
 * アイコンフォントは使わない（追加リクエストと FOUT を避けるため）。
 * 線幅は 1.0〜1.4px で、1px のヘアライン罫線と太さを揃えている。
 * 色は .ico 側の stroke: currentColor で継承させるので、
 * symbol の中に fill / stroke を書かないこと。
 */

export const SPRITE = `
<svg class="sprite" aria-hidden="true" focusable="false">
  <symbol id="i-flight" viewBox="0 0 24 24">
    <path d="M21.5 2.5 2.6 10.1l7.3 2.9m11.6-10.5L14 21.4l-2.8-8.4m10.3-10.5-10.3 10.5"/>
  </symbol>
  <symbol id="i-camera" viewBox="0 0 24 24">
    <path d="M3 8.6h3.5L8 6h8l1.5 2.6H21v10.4H3z"/>
    <circle cx="12" cy="13.4" r="3.2"/>
  </symbol>
  <symbol id="i-food" viewBox="0 0 24 24">
    <path d="M7.4 3v5.6a2.2 2.2 0 0 0 4.4 0V3M9.6 8.6V21M16.6 3c-1.5 1.5-2.2 3.4-2.2 5.4 0 1.7.9 2.8 2.2 3.1V21"/>
  </symbol>
  <symbol id="i-hotel" viewBox="0 0 24 24">
    <path d="M3 6.5v12"/>
    <path d="M3 13.2h18V18.5"/>
    <path d="M6.4 10.4h4.2"/>
    <path d="M13.4 13.2v-2.8h5.1A2.5 2.5 0 0 1 21 12.9"/>
  </symbol>
  <symbol id="i-shop" viewBox="0 0 24 24">
    <path d="M5.2 8h13.6l1 12H4.2z"/>
    <path d="M9 8V6.2a3 3 0 0 1 6 0V8"/>
  </symbol>
  <symbol id="i-car" viewBox="0 0 24 24">
    <path d="M4.6 17.2v2.2h3v-2.2M16.4 17.2v2.2h3v-2.2"/>
    <path d="M3 17.2v-4.6L5.1 7h13.8l2.1 5.6v4.6z"/>
    <path d="M3 12.6h18"/>
    <path d="M6.9 14.9h.01M17.1 14.9h.01"/>
  </symbol>
  <symbol id="i-boat" viewBox="0 0 24 24">
    <path d="M2.8 18.2c1.6 0 1.6 1.6 3.2 1.6s1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6"/>
    <path d="M4.6 15.6 6.2 9.5h11.6l1.6 6.1z"/>
    <path d="M12 9.5V4.6H7.8"/>
  </symbol>
  <symbol id="i-arrow-right" viewBox="0 0 24 24">
    <path d="M3.5 12h17m-6.5-6.5L20.5 12 14 18.5"/>
  </symbol>
  <symbol id="i-calendar" viewBox="0 0 24 24">
    <path d="M3.8 5.8h16.4v14.4H3.8z"/>
    <path d="M3.8 10.2h16.4M8.4 3.4v4.4M15.6 3.4v4.4"/>
  </symbol>
  <symbol id="i-clock" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8.6"/>
    <path d="M12 6.6v5.7l3.6 2.1"/>
  </symbol>
  <symbol id="i-pin" viewBox="0 0 24 24">
    <path d="M12 21.2s6.6-6.4 6.6-10.8a6.6 6.6 0 1 0-13.2 0C5.4 14.8 12 21.2 12 21.2Z"/>
    <circle cx="12" cy="10.4" r="2.5"/>
  </symbol>
  <symbol id="i-external" viewBox="0 0 24 24">
    <path d="M13.6 3.8h6.6v6.6M20.2 3.8 10.6 13.4"/>
    <path d="M17.6 14v6.2H3.8V6.4H10"/>
  </symbol>
  <symbol id="i-chat" viewBox="0 0 24 24">
    <path d="M4 4.8h16v11.4H9.4L4 20.4z"/>
  </symbol>
  <symbol id="i-search" viewBox="0 0 24 24">
    <circle cx="10.8" cy="10.8" r="6.6"/>
    <path d="m15.7 15.7 4.6 4.6"/>
  </symbol>
  <symbol id="i-luggage" viewBox="0 0 24 24">
    <path d="M5.8 7.6h12.4v12.6H5.8z"/>
    <path d="M9.4 7.6V4.4h5.2v3.2M9.6 11.2v5.4M14.4 11.2v5.4"/>
  </symbol>
  <symbol id="i-lock" viewBox="0 0 24 24">
    <path d="M4.8 10.8h14.4v9.4H4.8z"/>
    <path d="M8.4 10.8V7.4a3.6 3.6 0 0 1 7.2 0v3.4"/>
  </symbol>
  <symbol id="i-note" viewBox="0 0 24 24">
    <path d="M4.6 3.8h14.8v16.4H4.6z"/>
    <path d="M8 8.4h8M8 12h8M8 15.6h4.6"/>
  </symbol>
  <symbol id="i-pool" viewBox="0 0 24 24">
    <path d="M2.6 15.4c1.6 0 1.6 1.5 3.2 1.5s1.6-1.5 3.2-1.5 1.6 1.5 3.2 1.5 1.6-1.5 3.2-1.5 1.6 1.5 3.2 1.5"/>
    <path d="M2.6 19.4c1.6 0 1.6 1.5 3.2 1.5s1.6-1.5 3.2-1.5 1.6 1.5 3.2 1.5 1.6-1.5 3.2-1.5 1.6 1.5 3.2 1.5"/>
    <path d="M7.6 15V4.8a2.2 2.2 0 0 1 4.4 0M16.4 14.2V4.8a2.2 2.2 0 0 0-4.4 0"/>
    <path d="M8 8.6h8"/>
  </symbol>
  <symbol id="i-x" viewBox="0 0 24 24">
    <path d="M6 6l12 12M18 6 6 18"/>
  </symbol>
</svg>`.trim();

export const ICON_IDS = [
  "i-flight", "i-camera", "i-food", "i-hotel", "i-shop", "i-car", "i-boat",
  "i-arrow-right", "i-calendar", "i-clock", "i-pin", "i-external",
  "i-chat", "i-search", "i-luggage", "i-lock", "i-note", "i-pool", "i-x",
];

// カテゴリ既定アイコンの対応表（旧 CATEGORY_ICON）は categories.js にある。
// このファイルはスプライトそのもの（symbol の実体と id の一覧）だけを扱う。

export function injectSprite(doc = document) {
  if (doc.querySelector("svg.sprite")) return;
  doc.body.insertAdjacentHTML("afterbegin", SPRITE);
}

export function icon(id, extraClass = "") {
  if (!ICON_IDS.includes(id)) {
    throw new Error(`icons: 未知のアイコン id です: ${id}`);
  }
  const cls = extraClass ? `ico ${extraClass}` : "ico";
  return `<svg class="${cls}"><use href="#${id}"/></svg>`;
}
