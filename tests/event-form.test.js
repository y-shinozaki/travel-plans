import test from "node:test";
import assert from "node:assert/strict";
import { emptyEvent, eventFormHtml, readEventForm, formProblems } from "../assets/js/event-form.js";
import { validateEvents, validateEvent } from "../assets/js/validate.js";

const DAYS = [
  { dow: "水", date: "8/12" }, { dow: "木", date: "8/13" }, { dow: "金", date: "8/14" },
];

/** フォームの初期値を id → 文字列の表にする（描画せずに読み出しを再現する） */
function valuesOf(ev) {
  return {
    "f-title": ev.title ?? "",
    "f-cat": ev.cat,
    "f-allday": ev.allDay ? "on" : "",
    "f-sday": String(ev.startDay),
    "f-eday": String(ev.endDay),
    "f-start": ev.allDay ? "" : "09:00",
    "f-end": ev.allDay ? "" : "10:30",
    "f-loc": ev.location ?? "",
    "f-lat": ev.lat == null ? "" : String(ev.lat),
    "f-lng": ev.lng == null ? "" : String(ev.lng),
    "f-url": ev.url ?? "",
    "f-notes": ev.notes ?? "",
  };
}
const getter = (values) => (id) => values[id] ?? "";

test("emptyEvent は検査を通る形を返す", () => {
  const ev = { ...emptyEvent(DAYS.length), title: "新しい予定" };
  assert.deepEqual(formProblems(ev, DAYS.length), []);
});

test("読み出した値が検査を通る", () => {
  const values = valuesOf({ ...emptyEvent(3), title: "ワット アルン" });
  const ev = readEventForm(getter(values));
  assert.deepEqual(formProblems(ev, 3), []);
  // 単体ではなく、本番と同じ入口でも通ること
  validateEvents({ updatedAt: "2026-08-09T10:00:00+09:00", days: DAYS, events: [{ ...ev, id: "ev-x" }] });
});

test("時刻が 10 進数に変換される", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-start": "10:35", "f-end": "15:05" };
  const ev = readEventForm(getter(values));
  assert.equal(ev.start, 10 + 35 / 60);
  assert.equal(ev.end, 15 + 5 / 60);
});

test("終日なら start / end を持たない", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-allday": "on" };
  const ev = readEventForm(getter(values));
  assert.equal("start" in ev, false);
  assert.equal("end" in ev, false);
  assert.equal(ev.allDay, true);
});

test("日をまたぐ予定は end < start でも妥当", () => {
  // 8/12 15:00 → 8/14 11:00 のホテル滞在。入れ替えて「直さない」こと
  const values = {
    ...valuesOf(emptyEvent(3)),
    "f-title": "バンコクホテル", "f-sday": "0", "f-eday": "2",
    "f-start": "15:00", "f-end": "11:00",
  };
  assert.deepEqual(formProblems(readEventForm(getter(values)), 3), []);
});

test("同じ日で終了が開始以前なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-start": "14:00", "f-end": "13:00" };
  const problems = formProblems(readEventForm(getter(values)), 3);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /終了/);
});

test("タイトルが空なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-title": "  " };
  assert.match(formProblems(readEventForm(getter(values)), 3).join(), /タイトル/);
});

test("終了日が開始日より前なら問題として返す", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-sday": "2", "f-eday": "0" };
  assert.match(formProblems(readEventForm(getter(values)), 3).join(), /終了日/);
});

test("座標は両方揃ったときだけ採る", () => {
  const only = { ...valuesOf(emptyEvent(3)), "f-lat": "13.74", "f-lng": "" };
  const ev = readEventForm(getter(only));
  assert.equal(ev.lat, null);
  assert.equal(ev.lng, null);
  assert.deepEqual(formProblems(ev, 3), []);
});

test("両方揃えば数値として採る", () => {
  const both = { ...valuesOf(emptyEvent(3)), "f-lat": "13.74", "f-lng": "100.49" };
  const ev = readEventForm(getter(both));
  assert.equal(ev.lat, 13.74);
  assert.equal(ev.lng, 100.49);
});

test("座標が数値でなければ問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-lat": "あ", "f-lng": "100" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /緯度/);
});

test("緯度の範囲外は問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-lat": "999", "f-lng": "100" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /緯度/);
});

test("http でない URL は問題として返す", () => {
  const bad = { ...valuesOf(emptyEvent(3)), "f-url": "javascript:alert(1)" };
  assert.match(formProblems(readEventForm(getter(bad)), 3).join(), /URL/);
});

test("空の URL は許す", () => {
  assert.deepEqual(formProblems(readEventForm(getter(valuesOf(emptyEvent(3)))), 3), []);
});

test("前後の空白は落とす", () => {
  const values = { ...valuesOf(emptyEvent(3)), "f-title": "  ワット  ", "f-loc": " BKK " };
  const ev = readEventForm(getter(values));
  assert.equal(ev.title, "ワット");
  assert.equal(ev.location, "BKK");
});

test("フォームの HTML がタイトルをエスケープする", () => {
  const ev = { ...emptyEvent(3), title: '<img src=x onerror="alert(1)">' };
  const html = eventFormHtml(ev, DAYS);
  assert.doesNotMatch(html, /<img\s+src=x/);
  assert.doesNotMatch(html, /onerror="/);
});

test("フォームの HTML に全カテゴリの選択肢がある", () => {
  const html = eventFormHtml(emptyEvent(3), DAYS);
  for (const cat of ["cat-move", "cat-sight", "cat-food", "cat-hotel", "cat-shop"]) {
    assert.ok(html.includes(cat), `${cat} の選択肢がありません`);
  }
});

test("フォームの HTML に日数ぶんの選択肢がある", () => {
  const html = eventFormHtml(emptyEvent(3), DAYS);
  for (const d of DAYS) assert.ok(html.includes(d.date), `${d.date} の選択肢がありません`);
});

/* ── 描画した HTML を読み戻す ──────────────────────────
 *
 * 上の 3 件（エスケープ・カテゴリ・日）は部分文字列しか見ていないので、
 * selected / checked / 時刻の value を全部落としても緑のままだった。
 * それは「既存の予定を開いて保存すると、日・カテゴリ・終日・時刻が
 * 既定値に戻る」という壊れ方そのもの。ブラウザが読むのと同じ値を
 * HTML から取り出し、readEventForm に通して元のイベントに戻ることを見る。
 */

const unescapeHtml = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** その id の入力欄について、ブラウザの .value に相当する文字列を取り出す。 */
function fieldValue(html, id) {
  const textarea = new RegExp(`<textarea id="${id}"[^>]*>([\\s\\S]*?)</textarea>`).exec(html);
  if (textarea) return unescapeHtml(textarea[1]);

  const select = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html);
  if (select) {
    const picked = /<option value="([^"]*)" selected>/.exec(select[1]);
    return picked ? unescapeHtml(picked[1]) : "";
  }

  const input = new RegExp(`<input([^>]*id="${id}"[^>]*)>`).exec(html);
  assert.ok(input, `${id} の入力欄が HTML にありません`);
  const attrs = input[1];
  // チェックが外れているとき "" を返すのは、DOM の getValue に課している約束と同じ
  if (/type="checkbox"/.test(attrs)) return /\schecked/.test(attrs) ? "on" : "";
  const value = /value="([^"]*)"/.exec(attrs);
  return value ? unescapeHtml(value[1]) : "";
}

const readBack = (ev, days = DAYS) => {
  const html = eventFormHtml(ev, days);
  return readEventForm((id) => fieldValue(html, id));
};

test("HTML に描いた値を読み戻すと元のイベントに戻る", () => {
  const ev = {
    cat: "cat-hotel",
    title: 'ホテル "A" & <b>',
    allDay: false,
    startDay: 1,
    endDay: 2,
    location: "Bangkok & Co. <'>",
    lat: 13.7278,
    lng: 100.5601,
    url: "https://example.com/?a=1&b=2",
    notes: "メモ\n2 行目 & <tag>",
    start: 15,
    end: 11.5,
  };
  assert.deepEqual(readBack(ev), ev);
});

test("終日のイベントも HTML から読み戻せる", () => {
  const ev = {
    cat: "cat-hotel",
    title: "バンコクホテル",
    allDay: true,
    startDay: 0,
    endDay: 2,
    location: "",
    lat: null,
    lng: null,
    url: "",
    notes: "",
  };
  assert.deepEqual(readBack(ev), ev);
});

test("フォームの HTML が場所・リンク・メモをエスケープする", () => {
  // renderers.test.js と同じ、レビューで実際に到達したペイロード
  const PAYLOAD = '<img src=x onerror="window.__pwned=1">';
  const ATTR_PAYLOAD = 'x" onerror="window.__pwned=1';
  const html = eventFormHtml(
    { ...emptyEvent(3), location: ATTR_PAYLOAD, url: ATTR_PAYLOAD, notes: PAYLOAD },
    DAYS
  );
  assert.doesNotMatch(html, /onerror="window/);
  assert.doesNotMatch(html, /<img\s+src=x/);
});

/* ── 引数と壊れた入力 ─────────────────────────────── */

test("dayCount が無い・数でないなら投げる", () => {
  // checkDayIndex は value >= dayCount で範囲を見るので、dayCount が NaN や
  // undefined だと比較が両方 false になり、日の検査だけが黙って無効になる
  const ev = { ...emptyEvent(3), startDay: 99, endDay: 99 };
  assert.match(formProblems(ev, 3).join(), /範囲外/);
  for (const bad of [undefined, NaN, 0, -1, 2.5, "3", null]) {
    assert.throws(() => formProblems(ev, bad), RangeError, `dayCount=${bad} で投げません`);
    assert.throws(() => emptyEvent(bad), RangeError, `dayCount=${bad} で投げません`);
  }
});

test("イベントがオブジェクトでなくても投げずに問題として返す", () => {
  for (const bad of [null, undefined, "ev", 3, []]) {
    const problems = formProblems(bad, 3);
    assert.ok(problems.length > 0, `${JSON.stringify(bad)} が問題なしになりました`);
  }
});

/* ── validate.js との文字列の約束 ───────────────────── */

test("値に「: 」が入っていても文言が欠けない", () => {
  // 名指しを「最後の ': ' で切る」当て推量にすると、ここで本文の頭が消える
  const problems = formProblems({ ...emptyEvent(3), cat: "a: b" }, 3);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^未知のカテゴリです/);
});

test("validateEvent は {field, message} を返し、名指しを付けない", () => {
  // 名指し（"ev-x: "）を付けるのは validateEvents 側だけ。ここが文字列を
  // 返す形に戻ると、1 件しか扱わないフォームがまた切り直す羽目になる
  const base = { id: "ev-x", title: "", cat: "cat-food", allDay: false, startDay: 0, endDay: 0, start: 12, end: 13, lat: null, lng: null };
  const broken = [
    { cat: "cat-x" },
    { startDay: 9, endDay: 9 },
    { startDay: 1, endDay: 0 },
    { startDay: 0.5 },
    { title: 1 },
    { start: NaN },
    { end: 25 },
    { lat: 13.7 },
    { lat: NaN, lng: 100 },
    { lat: 91, lng: 181 },
    { allDay: false, start: undefined, end: undefined },
  ];
  let seen = 0;
  for (const over of broken) {
    const problems = validateEvent({ ...base, ...over }, 3);
    assert.ok(problems.length > 0, `不備が出ません: ${JSON.stringify(over)}`);
    for (const p of problems) {
      seen++;
      assert.equal(typeof p.message, "function", "message は本文を作る関数");
      const body = p.message((key) => key);
      assert.ok(!body.startsWith("ev-x"), `名指しが混ざっています: ${body}`);
      // field は入力欄を指せる値か、イベント全体を指す null のどちらか
      assert.ok(
        p.field === null || typeof p.field === "string",
        `field が不正です: ${JSON.stringify(p.field)}`
      );
    }
  }
  assert.ok(seen >= broken.length);
});

test("validateEvents は名指しを付けて 1 本の文言にする", () => {
  // 名指しの形（"id「タイトル」: 本文"）は JSON を直接読む人向けの見え方。
  // 画面のエラー一覧はこれをそのまま出す
  const data = {
    days: [{ date: "8/12", dow: "火" }],
    events: [{ id: "ev-x", title: "出国", cat: "cat-nope", allDay: true, startDay: 0, endDay: 0, lat: null, lng: null }],
  };
  assert.throws(
    () => validateEvents(data),
    (error) => /ev-x「出国」: 未知のカテゴリです/.test(error.message)
  );
});

test("項目名の言い換えが値まで書き換えない", () => {
  /*
   * 以前は出来上がった本文に正規表現を当ててキー名を置換していたので、
   * **値の中に "start" や "title" を含む文字列があると、そこまで
   * 「開始時刻」「タイトル」に化けた**（設計書 §13）。
   * いまは message(nameOf) がキーの位置だけを名前にするので起こらない。
   */
  const problems = formProblems({ ...emptyEvent(3), cat: "start-end-title" }, 3);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"start-end-title"/, `値が書き換わっています: ${problems[0]}`);
  assert.ok(!problems[0].includes("開始時刻-終了時刻-タイトル"));
});

test("フォームの文言は項目名を日本語で名指しする", () => {
  // 規則は validate.js にしかない。ここで見るのは言い換えだけ
  const problems = formProblems({ ...emptyEvent(3), lat: 13.7, lng: null }, 3);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /緯度 \/ 経度/, problems[0]);
  assert.ok(!problems[0].includes("lat"), `キー名が残っています: ${problems[0]}`);
});
