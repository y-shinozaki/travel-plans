import { icon } from "./icons.js";

const PAGES = [
  { key: "schedule", href: "schedule.html", label: "旅程", ico: "i-calendar" },
  { key: "archive", href: "archive.html", label: "データ検索", ico: "i-search" },
  { key: "packing", href: "packing.html", label: "持ち物", ico: "i-luggage" },
];

export function renderNav(mount, current) {
  mount.innerHTML = `
    <a class="nav__home" href="index.html">Thailand 2026</a>
    <div class="nav__links">
      ${PAGES.map(
        (p) => `
        <a class="nav__link${p.key === current ? " is-current" : ""}"
           href="${p.href}"${p.key === current ? ' aria-current="page"' : ""}>
          ${icon(p.ico, "ico--sm")}<span>${p.label}</span>
        </a>`
      ).join("")}
    </div>`;
}
