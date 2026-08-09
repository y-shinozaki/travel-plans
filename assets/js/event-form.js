/**
 * 予定の編集フォーム。HTML の組み立て・入力の読み取り・保存前の検査を持つ。
 *
 * DOM を直接触らない（読み取りは getValue、書き出しは文字列）のは、
 * 「フォームが作った値がそのまま validateEvents() を通る」ことを
 * Node のテストで押さえるため。ここが破れると、保存はできるのに次の
 * 読み込みで validateEvents が投げ、ページが起動しなくなる。利用者から見ると
 * 「保存したら旅程が真っ白になり、画面からは戻す手段が無い」状態になる。
 *
 * そのため formProblems() は validateEvent() を呼ぶ。規則を書き写さない。
 * 写しは必ずずれ、ずれたことは保存して再読み込みするまで表に出ない。
 */

import { CAT_META } from "./categories.js";
import { decToHHMM, hhmmToDec } from "./time.js";
import { escapeHtml, safeHttpUrl } from "./dom.js";
import { validateEvent } from "./validate.js";

/**
 * 採番前の新規イベントを検査に掛けるための仮 id。
 * id は保存時に store 側が振るので、フォームは持たない。しかし
 * validateEvent は id を必須とするので、検査のあいだだけこれを被せる。
 */
const DRAFT_ID = "(新規)";

/**
 * 新規作成の初期値。id は保存時に採番するので持たせない。
 * 時刻の既定は 9:00 → 10:00（mock-aman.html の #evSheet と同じ）。
 */
export function emptyEvent(dayCount) {
  // 1 日も無いデータでは、どの日にも置けない予定ができてしまう。
  // validateEvents は days が空の時点で弾くので、ここへ来るのは呼び出し側の間違い
  if (!Number.isInteger(dayCount) || dayCount < 1) {
    throw new RangeError(`emptyEvent: 日が 1 つ以上必要です（${dayCount}）`);
  }
  return {
    cat: "cat-sight",
    title: "新しい予定",
    allDay: false,
    startDay: 0,
    endDay: 0,
    start: 9,
    end: 10,
    location: "",
    lat: null,
    lng: null,
    url: "",
    notes: "",
  };
}

/* ── HTML の組み立て ─────────────────────────────────── */

/** カテゴリの選択肢。CAT_META を唯一の出どころにする（画面に書き写さない）。 */
const catOptions = (selected) =>
  Object.entries(CAT_META)
    .map(
      ([cat, meta]) =>
        `<option value="${escapeHtml(cat)}"${cat === selected ? " selected" : ""}>` +
        `${escapeHtml(meta.label)}</option>`
    )
    .join("");

/** 日の選択肢。value は days[] の添字。 */
const dayOptions = (days, selected) =>
  days
    .map(
      (day, i) =>
        `<option value="${i}"${i === selected ? " selected" : ""}>` +
        `${escapeHtml(day.date)}（${escapeHtml(day.dow)}）</option>`
    )
    .join("");

/**
 * <input type="time"> に入れる値。
 * 保存に失敗した入力をそのまま出し直す場面があるので、壊れた値でも
 * 描けなければならない（decToHHMM は有限の数値でないと投げる）。
 * 数値になっていない入力は空欄で出す ── 直すべき欄がどれかは、
 * 添えて出すエラー文が示す。
 */
function timeValue(dec, fallback) {
  if (dec == null) return decToHHMM(fallback); // 終日から切り替えた直後など
  return Number.isFinite(dec) ? decToHHMM(dec) : "";
}

/** 緯度・経度の入力値。NaN や Infinity を "NaN" と表示しない。 */
const numValue = (value) => (Number.isFinite(value) ? String(value) : "");

/**
 * フォームの HTML。入力欄の id は readEventForm が読む id と対になっている。
 *
 * 値はすべて escapeHtml() を通す。Phase B ではここに入るのがブラウザで
 * 打った文字列で、しかもリポジトリ書き込み権限のトークンを持つページ自身が
 * 描画するため、素の代入は 1 か所でもトークンの漏洩に直結する。
 */
export function eventFormHtml(ev, days) {
  return `
    <div class="fgrid">
      <div class="field2">
        <label for="f-title">タイトル</label>
        <input class="inp" id="f-title" value="${escapeHtml(ev.title ?? "")}"
               placeholder="例: ワット アルン">
      </div>

      <div class="field2">
        <label for="f-cat">カテゴリ</label>
        <select id="f-cat">${catOptions(ev.cat)}</select>
      </div>

      <label class="switch">
        <span class="check">
          <input type="checkbox" id="f-allday"${ev.allDay ? " checked" : ""}>
          <span class="check__box"><svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d="m4.5 12.6 5.2 5.2L19.5 6.6"/></svg
          ></span>
        </span>
        <span>終日の予定にする</span>
      </label>

      <div class="fgrid fgrid--2">
        <div class="field2">
          <label for="f-sday">開始日</label>
          <select id="f-sday">${dayOptions(days, ev.startDay)}</select>
        </div>
        <div class="field2">
          <label for="f-eday">終了日</label>
          <select id="f-eday">${dayOptions(days, ev.endDay)}</select>
        </div>
      </div>

      <div class="fgrid fgrid--2" id="f-times">
        <div class="field2">
          <label for="f-start">開始時刻</label>
          <input class="inp" type="time" id="f-start" step="300"
                 value="${escapeHtml(timeValue(ev.start, 9))}">
        </div>
        <div class="field2">
          <label for="f-end">終了時刻</label>
          <input class="inp" type="time" id="f-end" step="300"
                 value="${escapeHtml(timeValue(ev.end, 10))}">
        </div>
      </div>

      <div class="field2">
        <label for="f-loc">場所</label>
        <input class="inp" id="f-loc" value="${escapeHtml(ev.location ?? "")}"
               placeholder="例: Wat Arun Ratchawararam">
      </div>

      <div class="fgrid fgrid--2">
        <div class="field2">
          <label for="f-lat">緯度</label>
          <input class="inp" id="f-lat" inputmode="decimal"
                 value="${escapeHtml(numValue(ev.lat))}" placeholder="13.7438">
        </div>
        <div class="field2">
          <label for="f-lng">経度</label>
          <input class="inp" id="f-lng" inputmode="decimal"
                 value="${escapeHtml(numValue(ev.lng))}" placeholder="100.4884">
        </div>
      </div>
      <p class="fhint">緯度と経度を両方入れると地図にピンが立ちます。片方だけでは立ちません。</p>

      <div class="field2">
        <label for="f-url">リンク</label>
        <input class="inp" id="f-url" inputmode="url"
               value="${escapeHtml(ev.url ?? "")}" placeholder="https://">
      </div>

      <div class="field2">
        <label for="f-notes">メモ</label>
        <textarea id="f-notes" placeholder="補足があれば">${escapeHtml(ev.notes ?? "")}</textarea>
      </div>

      <div id="f-error"></div>
    </div>`;
}

/* ── 入力の読み取り ──────────────────────────────────── */

/** 選択肢の添字。空欄は 0 ではなく NaN にして、検査に拾わせる。 */
const toIndex = (text) => (text === "" ? NaN : Number(text));

/**
 * HH:MM を 10 進時間へ。読めない値でも投げない。
 *
 * 空欄や壊れた値を例外にすると、保存ボタンが素の TypeError で落ち、
 * 画面には何も出ない。NaN のまま持ち上げれば validateEvent が
 * 「有限の数値ではありません」として、どの欄の話かごと言ってくれる。
 */
function toDec(text) {
  try {
    return hhmmToDec(text);
  } catch {
    return NaN;
  }
}

/**
 * フォームの入力をイベントの形に直す。
 *
 * getValue(id) は「その id の入力欄の値を文字列で返す」関数。DOM を
 * 引数に取らないのは、この変換を Node のテストで押さえるため。
 *
 * チェックボックスについては、外れているときに "" を返す getValue を渡すこと。
 * DOM の input.value はチェックの有無に関わらず既定で "on" を返すので、
 * el.value をそのまま流すと終日が常に true になる。
 *
 * 返すイベントに id は入らない（保存時に採番する）。
 */
export function readEventForm(getValue) {
  const text = (id) => String(getValue(id) ?? "").trim();

  const allDay = text("f-allday") !== "";

  // 片方だけの座標は「座標なし」と見分けが付かない（validate.js の checkCoords）。
  // 両方揃ったときだけ数値として採り、片方だけなら両方 null にする
  const latText = text("f-lat");
  const lngText = text("f-lng");
  const hasCoords = latText !== "" && lngText !== "";

  // events.json 上のキーの並びに合わせて組み立てる（差分を読みやすく保つため）
  const ev = {
    cat: text("f-cat"),
    title: text("f-title"),
    allDay,
    startDay: toIndex(text("f-sday")),
    endDay: toIndex(text("f-eday")),
  };
  if (!allDay) {
    ev.start = toDec(text("f-start"));
    ev.end = toDec(text("f-end"));
  }
  ev.location = text("f-loc");
  ev.lat = hasCoords ? Number(latText) : null;
  ev.lng = hasCoords ? Number(lngText) : null;
  ev.url = text("f-url");
  ev.notes = text("f-notes");
  return ev;
}

/* ── 保存前の検査 ────────────────────────────────────── */

/**
 * validate.js のメッセージは events.json を直接編集する人向けに書かれていて、
 * 項目を JSON のキー名（lat、endDay …）で名指しする。フォームの利用者は
 * そのキーを見ていないので、画面に出ている項目名へ言い換える。
 * 言い換えるのは言葉だけで、規則そのものは validateEvent 側にしか無い。
 */
const FIELD_WORDS = {
  startDay: "開始日",
  endDay: "終了日",
  start: "開始時刻",
  end: "終了時刻",
  title: "タイトル",
  cat: "カテゴリ",
  lat: "緯度",
  lng: "経度",
};

// 長い名前から順に当てる（endDay を end + Day に割らないため）。
// 直後が "-" のものは cat-hotel のような「値」の一部なので置き換えない
const FIELD_RE = new RegExp(
  `\\b(${Object.keys(FIELD_WORDS)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b(?!-)`,
  "g"
);

function inFormWords(message) {
  // validate.js のメッセージは「どのイベントか: 本文」の形。フォームは
  // 1 件しか扱わないので名指しの部分は落とす。本文に ": " は現れないため、
  // 最後の ": " が境目になる（タイトルに ": " が入っていても取り違えない）
  const cut = message.startsWith(DRAFT_ID) ? message.lastIndexOf(": ") : -1;
  const body = cut === -1 ? message : message.slice(cut + 2);
  return body.replace(FIELD_RE, (name) => FIELD_WORDS[name]);
}

/**
 * 保存してよいかを調べ、直すべき点の一覧を返す（空配列なら保存してよい）。
 *
 * 本体は validateEvent()。ここに足すのはフォーム固有の規則だけで、
 * どれも validateEvent より厳しい側にしか働かない ── 逆向きの規則を足すと、
 * 「フォームは通すが読み込みで弾かれる」値ができてしまう。
 *
 * id の重複だけはここでは見られない（他のイベントを知らないため）。
 * 採番と重複の回避は保存側の責任。
 */
export function formProblems(ev, dayCount) {
  const problems = [];

  // 空のタイトルは validateEvent を通る（型としては文字列なので）。
  // ただし一覧でもカレンダーでも「（無題）」としか出ず、後から探せなくなる
  if (typeof ev.title !== "string" || !ev.title.trim()) {
    problems.push("タイトルを入力してください。");
  }

  // 検査のあいだだけ仮 id を被せる。id はまだ振られていないが、
  // それ以外の規則は保存後とまったく同じものを通す
  problems.push(...validateEvent({ ...ev, id: DRAFT_ID }, dayCount).map(inFormWords));

  // 同じ日の中でだけ「終了は開始より後」を求める。日をまたぐ滞在では
  // 15:00 → 翌々日 11:00 のような指定が正しく、validateEvent もそれを通す
  if (!ev.allDay && ev.startDay === ev.endDay && ev.end <= ev.start) {
    problems.push("同じ日の中では、終了時刻を開始時刻より後にしてください。");
  }

  // href に載せられるのは http / https だけ（dom.js の safeHttpUrl）。
  // 空欄は「リンク無し」として許す
  if (ev.url && !safeHttpUrl(ev.url)) {
    problems.push("URL は http:// か https:// で始まる形にしてください。");
  }

  return problems;
}
