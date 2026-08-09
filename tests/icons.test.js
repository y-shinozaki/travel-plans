import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPRITE, ICON_IDS, icon, injectSprite } from "../assets/js/icons.js";

const idsInSprite = () => [...SPRITE.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

test("Phase A で使うアイコンがすべて含まれている", () => {
  const required = [
    // カテゴリ既定
    "i-flight", "i-camera", "i-food", "i-hotel", "i-shop",
    // events.json が個別に指定するもの（現行データに実在する 9 種類のうち上記以外）
    "i-car", "i-boat", "i-pool", "i-luggage",
    // UI 部品
    "i-arrow-right", "i-calendar", "i-clock", "i-pin", "i-external",
    "i-chat", "i-search", "i-lock", "i-note", "i-x",
  ];
  for (const id of required) {
    assert.ok(ICON_IDS.includes(id), `${id} が ICON_IDS にありません`);
  }
});

test("ICON_IDS とスプライトの中身が一致する", () => {
  assert.deepEqual([...ICON_IDS].sort(), [...idsInSprite()].sort());
});

test("symbol の id が重複していない", () => {
  const ids = idsInSprite();
  assert.equal(new Set(ids).size, ids.length);
});

test("すべての symbol が viewBox を持つ", () => {
  const symbols = [...SPRITE.matchAll(/<symbol\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(symbols.length > 0);
  for (const s of symbols) {
    assert.match(s, /viewBox="0 0 24 24"/, `viewBox がありません: ${s}`);
  }
});

test("symbol に色が直接書かれていない", () => {
  // currentColor で継承させるため、fill / stroke を symbol 内に書かない
  // クォートの種類（" / '）に関わらず検出できるようにする
  const body = SPRITE.replace(/<svg[^>]*>|<\/svg>/g, "");
  assert.doesNotMatch(body, /(?:fill|stroke)=["'](?!none["'])[^"']+["']/);
});

test("icon() は use 参照を返す", () => {
  assert.equal(icon("i-pin"), '<svg class="ico"><use href="#i-pin"/></svg>');
  assert.equal(icon("i-pin", "ico--sm"), '<svg class="ico ico--sm"><use href="#i-pin"/></svg>');
});

test("icon() は未知の id を拒否する", () => {
  assert.throws(() => icon("i-nope"), /i-nope/);
});

test("events.json が参照する個別アイコンがすべて存在する", () => {
  // 描画時に <use> が解決できず、アイコンが消えるのを防ぐ。
  // カテゴリ既定アイコンとの突き合わせは categories.test.js が受け持つ。
  const data = JSON.parse(
    readFileSync(new URL("../assets/data/events.json", import.meta.url), "utf8")
  );
  // 空配列だとループが 0 回で素通りするので、件数そのものを先に確かめる
  assert.equal(data.events.length, 43, "events.json の件数が想定と違います");
  for (const ev of data.events) {
    if (!ev.icon) continue;
    assert.ok(ICON_IDS.includes(ev.icon), `${ev.title}: ${ev.icon} がスプライトにありません`);
  }
});

// injectSprite が使うのは doc.querySelector と doc.body.insertAdjacentHTML の
// 2 つだけなので、それだけを備えた最小スタブで足りる（Node には DOM がない）。
const makeDocStub = ({ alreadyInjected = false } = {}) => {
  const calls = { querySelector: [], insertAdjacentHTML: [] };
  return {
    calls,
    doc: {
      querySelector(sel) {
        calls.querySelector.push(sel);
        return alreadyInjected ? {} : null;
      },
      body: {
        insertAdjacentHTML(...args) {
          calls.insertAdjacentHTML.push(args);
        },
      },
    },
  };
};

test("injectSprite はスプライトが無ければ挿入する", () => {
  const { doc, calls } = makeDocStub();
  injectSprite(doc);
  assert.deepEqual(calls.querySelector, ["svg.sprite"]);
  assert.equal(calls.insertAdjacentHTML.length, 1);
  assert.deepEqual(calls.insertAdjacentHTML[0], ["afterbegin", SPRITE]);
});

test("injectSprite はすでにあれば二重に挿入しない", () => {
  const { doc, calls } = makeDocStub({ alreadyInjected: true });
  injectSprite(doc);
  assert.deepEqual(calls.querySelector, ["svg.sprite"]);
  assert.equal(calls.insertAdjacentHTML.length, 0);
});
