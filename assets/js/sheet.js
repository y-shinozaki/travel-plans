import { timeLabel } from "./time.js";
import { icon } from "./icons.js";
import { catMeta, iconOf } from "./categories.js";
import { escapeHtml, safeHttpUrl } from "./dom.js";

/**
 * 右から出る詳細シートの器。
 * 開閉・フォーカス管理はここに閉じ込め、本文の生成は呼び出し側に任せる。
 * Phase B では同じ器に編集フォームを載せるため、読み取り専用の前提を
 * ここに書き込まない。
 */
export function createSheet({ root, overlay, titleEl, bodyEl, footEl, closeBtn }) {
  let lastFocused = null;

  // 閉じるボタンのアイコンも他と同じく icon() から作る。
  // HTML に <use href="#i-x"> を直書きすると、パース時点＝injectSprite() が
  // スプライトを挿す前に参照が解決されることになる。WebKit は解決に失敗した
  // <use> を、参照先の symbol が後から DOM に入っても解決し直さないことがあり、
  // そうなるとこのボタン唯一の手がかりであるグリフが空のまま残る。
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
    // フッターにボタンがあればそちらへフォーカスする。Phase B ではここに
    // 「保存」「削除」といったそのシートの主目的の操作が並ぶので、開いた直後の
    // フォーカスは閉じるボタンより主操作にあるほうが自然。
    // Phase A では footNodes を渡す呼び出しが無く footEl は常に空なので、
    // 実際には必ず closeBtn 側に落ちる（今は死んだ分岐に見えるが消さないこと）。
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

/**
 * days[] の添字は validate.js が読み込み時に検査している。
 * ここで再度確かめるのは、検査を通っていないデータ（Phase B の未保存の入力など）が
 * 来たときに、素の "Cannot read properties of undefined" ではなく
 * どのイベントのどの値が範囲外なのかが分かる形で落とすため。
 */
function dayAt(days, index, ev, which) {
  const day = days[index];
  if (!day) {
    throw new RangeError(
      `renderEventDetail: ${ev.id ?? "(id なし)"} の ${which} が範囲外です` +
        `（${index} / 有効な範囲は 0〜${days.length - 1}）`
    );
  }
  return day;
}

function dayRangeLabel(ev, days) {
  const from = dayAt(days, ev.startDay, ev, "startDay");
  const to = dayAt(days, Math.max(ev.endDay, ev.startDay), ev, "endDay");
  return ev.endDay > ev.startDay
    ? `${escapeHtml(from.date)}（${escapeHtml(from.dow)}） → ${escapeHtml(to.date)}（${escapeHtml(to.dow)}）`
    : `${escapeHtml(from.date)}（${escapeHtml(from.dow)}）`;
}

export function renderEventDetail(ev, days) {
  const image = ev.image
    ? `<img class="sheet__img" src="${escapeHtml(ev.image)}" alt=""
         style="object-position:${escapeHtml(ev.imagePos || "center")}">`
    : "";

  // 許可リストを通らなかった URL は、行ごと消さずに素のテキストとして出す。
  // 消すと「url が空だった」のか「弾かれた」のかが画面から分からず、
  // Phase B で URL を打ち間違えた人が原因に辿り着けない。
  // テキストなら値は読めるがクリックしても何も起きない（＝実行されない）。
  const safeUrl = ev.url ? safeHttpUrl(ev.url) : null;
  const link = !ev.url
    ? ""
    : safeUrl
      ? metaRow(
          "i-external",
          "Link",
          `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">
           開く ${icon("i-external", "ico--sm")}</a>`
        )
      : metaRow(
          "i-external",
          "Link",
          `<span class="ferror">開けない形式の URL です（http / https のみ）: ` +
            `${escapeHtml(ev.url)}</span>`
        );

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
