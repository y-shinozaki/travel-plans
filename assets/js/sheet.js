import { timeLabel } from "./time.js";
import { icon } from "./icons.js";
import { catMeta, iconOf } from "./categories.js";
import { escapeHtml } from "./dom.js";

/**
 * 右から出る詳細シートの器。
 * 開閉・フォーカス管理はここに閉じ込め、本文の生成は呼び出し側に任せる。
 * Phase B では同じ器に編集フォームを載せるため、読み取り専用の前提を
 * ここに書き込まない。
 */
export function createSheet({ root, overlay, titleEl, bodyEl, footEl, closeBtn }) {
  let lastFocused = null;

  // 閉じるボタンのアイコンも他と同じく icon() から作る。
  // HTML に <use href="#i-x"> を直書きすると、injectSprite() より前に
  // 解決を試みることになり（iOS Safari で実績のある不具合）、
  // このボタン唯一の手がかりであるグリフが消えかねない。
  closeBtn.innerHTML = icon("i-x", "ico--sm");

  /**
   * body 直下の子要素のうち、シート自身とオーバーレイを除いたもの。
   * aria-modal="true" を名乗る以上、背景は本当にフォーカス・クリック・
   * 支援技術から隔離しないと宣言と実装が食い違う。inert はそれを一括で
   * 行うので、要素ごとに tabindex を操作するより確実。
   * body の子要素を都度読み直すのは、nav/main 以外の要素が将来
   * 増えても（Phase B でフッターが増える等）取りこぼさないため。
   */
  function inertTargets() {
    return [...document.body.children].filter((el) => el !== root && el !== overlay);
  }

  /**
   * シート自身の inert。背景側（inertTargets）とは常に逆になる。
   * 閉じているシートは transform で画面外へ出ているだけなので、inert を
   * 付けないと閉じるボタンが「見えないタブストップ」として残ってしまう。
   * これで aria-hidden の付け外しは不要になる（inert は支援技術からも隠す）。
   */
  function setOpen(open) {
    root.classList.toggle("is-open", open);
    overlay.classList.toggle("is-open", open);
    root.inert = !open;
    for (const el of inertTargets()) el.inert = open;
  }

  setOpen(false);

  function open(title, bodyHtml, footNodes = []) {
    lastFocused = document.activeElement;
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    footEl.innerHTML = "";
    for (const node of footNodes) footEl.appendChild(node);

    setOpen(true);
    document.body.style.overflow = "hidden";
    bodyEl.scrollTop = 0;
    (footEl.querySelector("button") ?? closeBtn).focus();
  }

  function close() {
    // setOpen(false) がシートを inert にした時点で、シート内にあった
    // フォーカスは body へ外れる。背景の inert もここで同時に解けるので、
    // 直後の lastFocused.focus() は必ず成功する。
    setOpen(false);
    document.body.style.overflow = "";
    lastFocused?.focus();
  }

  const isOpen = () => root.classList.contains("is-open");

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  return { open, close, isOpen };
}

const metaRow = (iconId, label, value) =>
  `<div class="panel__mrow">${icon(iconId)}<dt>${label}</dt><dd>${value}</dd></div>`;

function dayRangeLabel(ev, days) {
  const from = days[ev.startDay];
  const to = days[Math.max(ev.endDay, ev.startDay)];
  return ev.endDay > ev.startDay
    ? `${escapeHtml(from.date)}（${escapeHtml(from.dow)}） → ${escapeHtml(to.date)}（${escapeHtml(to.dow)}）`
    : `${escapeHtml(from.date)}（${escapeHtml(from.dow)}）`;
}

export function renderEventDetail(ev, days) {
  const image = ev.image
    ? `<img class="sheet__img" src="${escapeHtml(ev.image)}" alt=""
         style="object-position:${escapeHtml(ev.imagePos || "center")}">`
    : "";

  const link = ev.url
    ? metaRow(
        "i-external",
        "Link",
        `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener">
           開く ${icon("i-external", "ico--sm")}</a>`
      )
    : "";

  const coords =
    ev.lat != null && ev.lng != null
      ? metaRow("i-pin", "Coords", `${escapeHtml(ev.lat)}, ${escapeHtml(ev.lng)}`)
      : "";

  const notes = ev.notes
    ? `<p class="body" style="margin-top:var(--s3);white-space:pre-wrap">${escapeHtml(ev.notes)}</p>`
    : "";

  return `
    ${image}
    <span class="panel__cat ${escapeHtml(ev.cat)}">
      ${icon(iconOf(ev), "ico--sm")} ${escapeHtml(catMeta(ev.cat).label)}
    </span>
    <h3 class="panel__title">${escapeHtml(ev.title) || "（無題）"}</h3>
    <dl class="panel__meta">
      ${metaRow("i-calendar", "Date", dayRangeLabel(ev, days))}
      ${metaRow("i-clock", "Time", escapeHtml(timeLabel(ev)))}
      ${ev.location ? metaRow("i-pin", "Location", escapeHtml(ev.location)) : ""}
      ${coords}
      ${link}
    </dl>
    ${notes}`;
}
