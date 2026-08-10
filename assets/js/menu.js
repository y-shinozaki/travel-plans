import { injectSprite, icon } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { countdownHtml } from "./countdown.js";
import { createStore } from "./store.js";
import { hasKey, unlock, clearKey } from "./auth.js";
import { isEnvelope } from "./crypto.js";
import { DEFAULT_CONFIG } from "./sync.js";

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
    href: "packing.html",
    num: "02",
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

/**
 * 合言葉の欄。鍵を持っていれば出さない（毎回入れさせない）。
 *
 * 画面は合言葉を一切表示し直さない ── 入力欄は type="password"、
 * 送信後に必ず空にし、状態は「設定済み／未設定」だけを出す（設計書 §5.4 と同じ規約）。
 *
 * ソルトはリモートの封筒から取る。まだ平文なら kdf が無いので null を渡し、
 * unlock が新しいソルトを生成する（切り替え当日の 1 回だけ通る経路）。
 */
function buildAuthForm(store) {
  const form = need("auth-form");
  const input = need("auth-pass");
  const status = need("auth-status");
  const submit = need("auth-submit");

  if (hasKey(store)) {
    form.hidden = true;
    return;
  }
  form.hidden = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const passphrase = input.value;
    if (!passphrase) {
      status.textContent = "合言葉を入力してください。";
      return;
    }

    submit.disabled = true;
    status.textContent = "鍵を作っています（数秒かかります）…";
    try {
      let body = null;
      try {
        const response = await fetch(DEFAULT_CONFIG.path, { cache: "no-store" });
        body = await response.json();
      } catch (error) {
        // 取れなくても止めない。新しいソルトで鍵を作り、次の公開で確定させる
        console.warn("menu: 既存のソルトを取得できませんでした", error);
      }

      const encrypted = isEnvelope(body);
      const codec = await unlock(store, passphrase, encrypted ? body.kdf : null);

      // 合言葉が正しいかは、ここで実際に復号して確かめる。**この確認を省かないこと。**
      //
      // ソルトは 3 つの JSON で共有する（設計書 §6.3）ので、合言葉を打ち間違えても
      // 封筒の kdf は一致する。確かめずに鍵を保存すると、間違った鍵を持ったまま
      // schedule.html へ進み、そこでは kdf が一致するために GCM の失敗が
      // 「データが壊れています」と表示される ── 実際は打ち間違いなのに、
      // 画面は直し方の違うことを言う。crypto.js の kdf 比較が捕まえられるのは
      // 「別のソルトで暗号化されている」場合だけで、いちばん起きやすい
      // 打ち間違いはここでしか捕まえられない（設計書 §9）。
      if (encrypted) {
        try {
          await codec.decode(body);
        } catch (error) {
          clearKey(store);
          status.textContent = "合言葉が違います。";
          return;
        }
      }

      form.hidden = true;
      status.textContent = "";
      location.reload();
    } catch (error) {
      console.error(error);
      clearKey(store);
      status.textContent = "鍵を作れませんでした。もう一度お試しください。";
    } finally {
      // 合言葉を DOM に残さない
      input.value = "";
      submit.disabled = false;
    }
  });
}

function main() {
  injectSprite();
  renderNav(need("nav"), null);
  buildAuthForm(createStore());
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
