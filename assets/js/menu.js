import { injectSprite, icon } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { countdownHtml } from "./countdown.js";

const DEPARTURE = new Date("2026-08-12T00:00:00+09:00");
const SUBTITLE = "依田家・篠崎家 合同";

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

function cardHtml(card, index) {
  return `
  <a class="card reveal" href="${card.href}" style="--d:${(index * 0.12).toFixed(2)}s">
    <div class="card__img">
      <span class="card__num">${card.num}</span>
      <img src="${card.image}" alt="" loading="lazy">
    </div>
    <div class="card__body">
      <p class="eyebrow">${card.eyebrow}</p>
      <h2 class="h3">${icon(card.ico)} ${card.title}</h2>
      <p class="micro">${card.desc}</p>
      <span class="swipe card__arrow">開く ${icon("i-arrow-right", "ico--sm")}</span>
    </div>
  </a>`;
}

/** id で引いた要素が無ければ、そこで名前を挙げて止める（null に代入して静かに壊れない）。 */
function need(id) {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`menu: #${id} が index.html にありません`);
  }
  return node;
}

function main() {
  injectSprite();
  renderNav(need("nav"), null);
  need("menu").innerHTML = CARDS.map(cardHtml).join("");
  need("countdown").innerHTML = countdownHtml(DEPARTURE, SUBTITLE);
}

/**
 * index.html はサイトの入口で、しかも静的マークアップ側に .reveal / .lines を
 * 持っている。base.css の `.reveal { opacity: 0 }` を解除するのは initReveal() が
 * 付ける is-in だけなので、その手前で例外が出ると（アイコン id の打ち間違い、
 * 要素 id の改名で getElementById が null、など）ページ全体が
 * 「真っ白 + コンソールに例外 1 本」になる。
 *
 * schedule.js と同じ形にする ── 失敗しても initReveal() は必ず走らせ、
 * 何が起きたかを画面にも出す。
 */
function showFatal(error) {
  const mount = document.getElementById("menu") ?? document.querySelector("main");
  if (!mount) return;
  const p = document.createElement("p");
  p.className = "ferror ferror--block";
  p.setAttribute("role", "alert");
  p.textContent =
    "このページを組み立てられませんでした。\n" +
    "ページを再読み込みしても直らない場合は、ブラウザのコンソールを確認してください。\n\n" +
    `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
  mount.replaceChildren(p);
}

try {
  main();
} catch (error) {
  console.error(error);
  showFatal(error);
} finally {
  initReveal();
}
