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
import { isPlainObject } from "./plain-object.js";

/**
 * 採番前の新規イベントを検査に掛けるための仮 id。
 * id は保存時に store 側が振るので、フォームは持たない。しかし
 * validateEvent は id を必須とするので、検査のあいだだけこれを被せる。
 */
const DRAFT_ID = "(新規)";

/**
 * dayCount を受け取る関数はすべてこれを最初に通す。
 *
 * 検査を素通りさせないための番人。validate.js の checkDayIndex は
 * `value < 0 || value >= dayCount` で日の範囲を見るので、dayCount が
 * undefined や NaN だと**比較が両方 false になり、どんな startDay も通る**。
 * つまり日付の検査だけが黙って全部無効になる ── その状態で保存されたデータは
 * 次の読み込みで validateEvents に弾かれ、ページが起動しなくなる。
 * 入力からは起こらないが、呼び出し側が引数を落とせば起こる。
 */
function requireDayCount(fname, dayCount) {
  if (!Number.isInteger(dayCount) || dayCount < 1) {
    throw new RangeError(`${fname}: dayCount は 1 以上の整数が必要です（${dayCount}）`);
  }
}

/**
 * 新規作成の初期値。id は保存時に採番するので持たせない。
 * 時刻の既定は 9:00 → 10:00（aman-mock.html の #evSheet と同じ）。
 */
export function emptyEvent(dayCount) {
  // 1 日も無いデータでは、どの日にも置けない予定ができてしまう
  requireDayCount("emptyEvent", dayCount);
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

  // キーの並びは events.json の既存イベントに合わせる（start / end は末尾）。
  // 新しい予定だけ並びが違うと、公開したときの差分が読みにくくなる
  const ev = {
    cat: text("f-cat"),
    title: text("f-title"),
    allDay,
    startDay: toIndex(text("f-sday")),
    endDay: toIndex(text("f-eday")),
    location: text("f-loc"),
    lat: hasCoords ? Number(latText) : null,
    lng: hasCoords ? Number(lngText) : null,
    url: text("f-url"),
    notes: text("f-notes"),
  };
  // 終日の予定は start / end を「持たない」。null を入れると
  // 「終日でないのに時刻が無い」形と区別が付かなくなる
  if (!allDay) {
    ev.start = toDec(text("f-start"));
    ev.end = toDec(text("f-end"));
  }
  return ev;
}

/* ── 保存前の検査 ────────────────────────────────────── */

/**
 * validate.js のメッセージは events.json を直接編集する人向けに書かれていて、
 * 項目を JSON のキー名（lat、endDay …）で名指しする。フォームの利用者は
 * そのキーを見ていないので、画面に出ている項目名へ言い換える。
 * 言い換えるのは言葉だけで、規則そのものは validateEvent 側にしか無い。
 *
 * **この表は validateEvent が返す Problem の message() へ渡すだけ**で、
 * 出来上がった文章に正規表現を当てるのではない。以前は本文を
 * 置換していたので、置換対象がキー名だけでなく**値の中にも当たった**
 * （cat や location に "start" を含む文字列があれば、そこまで
 * 「開始時刻」に書き換わる）。設計書 §13。
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
  id: "ID",
};

/** Problem.message() へ渡す。表に無いキーはそのまま出す。 */
const formName = (key) => FIELD_WORDS[key] ?? key;

/** 不備 1 件をフォームの言葉にする。名指しの切り出しはもう要らない。 */
const inFormWords = (p) => p.message(formName);

/**
 * イベントとして扱える形か。
 * validate.js の isPlainObject と同じ判定なので、そちらから import する
 * （2 か所に置くと、片方だけ緩めたときに気付けない。設計書 §13）。
 */
const isEventObject = isPlainObject;

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
  requireDayCount("formProblems", dayCount);

  // オブジェクトでなければフォームの規則を当てても意味がない。展開する前に
  // validateEvent へ渡して言わせる（公開関数なので、素の TypeError ではなく
  // 問題の一覧で返す）
  if (!isEventObject(ev)) return validateEvent(ev, dayCount).map(inFormWords);

  const problems = [];

  // 空のタイトルは validateEvent を通る（型としては文字列なので）。
  // ただし一覧でもカレンダーでも「（無題）」としか出ず、後から探せなくなる
  if (typeof ev.title !== "string" || !ev.title.trim()) {
    problems.push("タイトルを入力してください。");
  }

  // 検査には仮 id を被せた写しを渡す（validateEvent は id を必須とするが、
  // 採番は保存側の仕事なのでフォームは持っていない）。
  // title を空にするのは、直前の必須チェックと二重に文句を言わせないため
  // ── そちらのほうが厳しいので、validateEvent 側の「title が文字列か」を
  // 外しても抜けはない。
  // （名指しの切り出しはもう無いので、title を空にする理由はこれだけになった）
  const draft = { ...ev, id: DRAFT_ID, title: "" };
  problems.push(...validateEvent(draft, dayCount).map(inFormWords));

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
