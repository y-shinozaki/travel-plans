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
import { escapeHtml } from "../assets/js/dom.js";
import { renderEventDetail } from "../assets/js/sheet.js";
import { popupHtml, locationRowHtml } from "../assets/js/map.js";
import { renderCalendar } from "../assets/js/calendar.js";

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

function renderWithStub(days, events) {
  const stub = installDomStub();
  try {
    const mount = stub.makeNode("div");
    renderCalendar({
      mount,
      days,
      events,
      viewStart: 6,
      viewEnd: 22,
      catFilter: null,
      onSelect: () => {},
    });
    return { mount, htmlSinks: stub.htmlSinks, textSinks: stub.textSinks };
  } finally {
    stub.restore();
  }
}

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
