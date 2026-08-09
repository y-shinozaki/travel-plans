import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ICON_IDS } from "../assets/js/icons.js";
import {
  CAT_META,
  catMeta,
  iconOf,
  accentToken,
} from "../assets/js/categories.js";

const CATEGORIES = ["cat-move", "cat-sight", "cat-food", "cat-hotel", "cat-shop"];

test("Phase A のカテゴリがすべて定義されている", () => {
  assert.deepEqual(Object.keys(CAT_META).sort(), [...CATEGORIES].sort());
});

test("すべてのカテゴリにラベルと既定アイコンがある", () => {
  for (const cat of CATEGORIES) {
    assert.ok(CAT_META[cat].label, `${cat} のラベルがありません`);
    assert.ok(CAT_META[cat].icon, `${cat} の既定アイコンがありません`);
    assert.ok(ICON_IDS.includes(CAT_META[cat].icon), `${cat}: スプライトに無いアイコンです`);
  }
});

test("iconOf はイベント個別指定を優先する", () => {
  assert.equal(iconOf({ cat: "cat-move" }), "i-flight");
  assert.equal(iconOf({ cat: "cat-move", icon: "i-boat" }), "i-boat");
});

test("accentToken は tokens.css のカスタムプロパティ名を返す", () => {
  assert.equal(accentToken("cat-move"), "--c-move");
  assert.equal(accentToken("cat-shop"), "--c-shop");
});

test("accentToken が返す名前は tokens.css に実在する", () => {
  const css = readFileSync(new URL("../assets/css/tokens.css", import.meta.url), "utf8");
  for (const cat of CATEGORIES) {
    assert.match(css, new RegExp(`${accentToken(cat)}\\s*:`), `${cat} のトークンがありません`);
  }
});

test("未知のカテゴリは 3 つの入口すべてで同じように例外になる", () => {
  // 以前は catMeta 相当が TypeError、accentColor は空文字を黙って返していた。
  // データ不備の壊れ方を 1 通りに揃えるのがこのテストの目的。
  for (const fn of [
    () => catMeta("cat-nope"),
    () => iconOf({ cat: "cat-nope" }),
    () => accentToken("cat-nope"),
  ]) {
    assert.throws(fn, (err) => {
      assert.ok(err instanceof Error, "Error のはずです");
      assert.match(err.message, /cat-nope/, "メッセージにカテゴリ名が入っていません");
      return true;
    });
  }
});

test("events.json のカテゴリがすべて既知である", () => {
  const data = JSON.parse(
    readFileSync(new URL("../assets/data/events.json", import.meta.url), "utf8")
  );
  assert.equal(data.events.length, 40, "events.json の件数が想定と違います");
  for (const ev of data.events) {
    assert.doesNotThrow(() => catMeta(ev.cat), `${ev.title}: ${ev.cat}`);
    assert.ok(ICON_IDS.includes(iconOf(ev)), `${ev.title}: ${iconOf(ev)} がスプライトにありません`);
  }
});
