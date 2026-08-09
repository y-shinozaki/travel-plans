import { injectSprite, icon } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";

const DEPARTURE = new Date("2026-08-12T00:00:00+09:00");

const CARDS = [
  {
    href: "schedule.html",
    num: "01",
    eyebrow: "Itinerary",
    title: "旅程",
    ico: "i-calendar",
    desc: "6日間のタイムライン、地図、各スポットの詳細とメモ。",
    image:
      "https://www.thailandtravel.or.jp/wp-content/uploads/2017/07/241531199_1074098326727081_2405869266411881148_nSNSre.jpg",
  },
  {
    href: "archive.html",
    num: "02",
    eyebrow: "Archive",
    title: "データ検索",
    ico: "i-search",
    desc: "Gmail と LINE から集めた予約・やりとりを横断検索。",
    image:
      "https://enjoy-bkk.com/wp-content/uploads/2016/10/EmQuartier-1200-628.jpg",
  },
  {
    href: "packing.html",
    num: "03",
    eyebrow: "Packing",
    title: "持ち物リスト",
    ico: "i-luggage",
    desc: "二人分のチェックリスト。アイテムごとにメモを残せます。",
    image:
      "https://www.thailandtravel.or.jp/wp-content/uploads/2017/03/01871-808x538.jpg",
  },
];

injectSprite();
renderNav(document.getElementById("nav"), null);

document.getElementById("menu").innerHTML = CARDS.map(
  (c, i) => `
  <a class="card reveal" href="${c.href}" style="--d:${(i * 0.12).toFixed(2)}s">
    <div class="card__img">
      <span class="card__num">${c.num}</span>
      <img src="${c.image}" alt="" loading="lazy">
    </div>
    <div class="card__body">
      <p class="eyebrow">${c.eyebrow}</p>
      <h2 class="h3">${icon(c.ico)} ${c.title}</h2>
      <p class="micro">${c.desc}</p>
      <span class="swipe card__arrow">開く ${icon("i-arrow-right", "ico--sm")}</span>
    </div>
  </a>`
).join("");

const daysLeft = Math.ceil((DEPARTURE - Date.now()) / 86_400_000);
document.getElementById("countdown").innerHTML =
  daysLeft > 0
    ? `出発まで あと ${daysLeft} 日<br>依田家・篠崎家 合同`
    : "依田家・篠崎家 合同";

initReveal();
