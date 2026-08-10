/**
 * packing.html 専用のエントリポイント（archive.html は B4 で取りやめて削除した）。
 * CSP で script-src 'self' にしたため、インライン module は使えない。
 * どのページかは <body data-page="..."> から取る。
 */
import { injectSprite } from "./icons.js";
import { renderNav } from "./nav.js";

try {
  injectSprite();
  renderNav(document.getElementById("nav"), document.body.dataset.page ?? null);
} catch (error) {
  console.error("ページの初期化に失敗しました", error);
}
