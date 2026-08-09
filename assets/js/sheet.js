import { timeLabel } from "./time.js";
import { icon, CATEGORY_ICON } from "./icons.js";
import { CAT_META } from "./calendar.js";

/**
 * 右から出る詳細シートの器。
 * 開閉・フォーカス管理はここに閉じ込め、本文の生成は呼び出し側に任せる。
 * Phase B では同じ器に編集フォームを載せるため、読み取り専用の前提を
 * ここに書き込まない。
 */
export function createSheet({ root, overlay, titleEl, bodyEl, footEl, closeBtn }) {
  let lastFocused = null;

  function open(title, bodyHtml, footNodes = []) {
    lastFocused = document.activeElement;
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    footEl.innerHTML = "";
    for (const node of footNodes) footEl.appendChild(node);

    root.classList.add("is-open");
    overlay.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    bodyEl.scrollTop = 0;
    (footEl.querySelector("button") ?? closeBtn).focus();
  }

  function close() {
    root.classList.remove("is-open");
    overlay.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
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

const iconOf = (ev) => ev.icon || CATEGORY_ICON[ev.cat];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const metaRow = (iconId, label, value) =>
  `<div class="panel__mrow">${icon(iconId)}<dt>${label}</dt><dd>${value}</dd></div>`;

function dayRangeLabel(ev, days) {
  const from = days[ev.startDay];
  const to = days[Math.max(ev.endDay, ev.startDay)];
  return ev.endDay > ev.startDay
    ? `${from.date}（${from.dow}） → ${to.date}（${to.dow}）`
    : `${from.date}（${from.dow}）`;
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
    ev.lat != null && ev.lng != null ? metaRow("i-pin", "Coords", `${ev.lat}, ${ev.lng}`) : "";

  const notes = ev.notes
    ? `<p class="body" style="margin-top:var(--s3);white-space:pre-wrap">${escapeHtml(ev.notes)}</p>`
    : "";

  return `
    ${image}
    <span class="panel__cat ${ev.cat}">
      ${icon(iconOf(ev), "ico--sm")} ${CAT_META[ev.cat].label}
    </span>
    <h3 class="panel__title">${escapeHtml(ev.title) || "（無題）"}</h3>
    <dl class="panel__meta">
      ${metaRow("i-calendar", "Date", dayRangeLabel(ev, days))}
      ${metaRow("i-clock", "Time", timeLabel(ev))}
      ${ev.location ? metaRow("i-pin", "Location", escapeHtml(ev.location)) : ""}
      ${coords}
      ${link}
    </dl>
    ${notes}`;
}
