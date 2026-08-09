import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAT_META } from "../assets/js/categories.js";

const css = readFileSync(new URL("../assets/css/tokens.css", import.meta.url), "utf8");
const readCss = (name) =>
  readFileSync(new URL(`../assets/css/${name}`, import.meta.url), "utf8");

function readTokens(src) {
  const map = new Map();
  for (const m of src.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    map.set(m[1], m[2].toUpperCase());
  }
  return map;
}

function readLengthTokens(src) {
  const map = new Map();
  for (const m of src.matchAll(/--([a-z0-9-]+)\s*:\s*(-?[\d.]+(?:px|rem|em|%)|0)\s*;/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function relativeLuminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function distance(a, b) {
  const A = rgb(a);
  const B = rgb(b);
  return Math.sqrt(A.reduce((n, v, i) => n + (v - B[i]) ** 2, 0));
}

const T = readTokens(css);
const L = readLengthTokens(css);
/**
 * カテゴリ一覧は CAT_META から導く。ここに書き写すと、CAT_META に
 * cat-transport を足して CSS を忘れても全テストが通ってしまう
 * （＝無色のピンが出る状態を誰も検知できない）。
 */
const CAT_KEYS = Object.keys(CAT_META);
const CATEGORIES = CAT_KEYS.map((key) => key.slice("cat-".length));

test("パースが壊れていない（主要な色トークンが十分な数取れている）", () => {
  // readTokens が空／ほぼ空でも他のテストはループ0回で素通りしてしまうため、
  // パーサが機能していることを別途チェックする。
  assert.ok(T.size >= 20, `カラートークンが ${T.size} 件しか取れていません（20件未満）`);
});

test("基本トークンがすべて定義されている", () => {
  for (const name of ["sand", "sand-lt", "paper", "ink", "ink-2", "ink-3", "line",
                      "line-soft", "line-faint"]) {
    assert.ok(T.has(name), `--${name} が定義されていません`);
  }
});

test("CAT_META からカテゴリ一覧が取れている（テストが空回りしていない）", () => {
  assert.ok(CATEGORIES.length >= 5, `カテゴリが ${CATEGORIES.length} 件しか取れていません`);
});

test("カテゴリごとに3値が揃っている", () => {
  for (const c of CATEGORIES) {
    for (const suffix of ["", "-bg", "-tx"]) {
      const name = `c-${c}${suffix}`;
      assert.ok(T.has(name), `--${name} が定義されていません（tokens.css）`);
    }
  }
});

test("CAT_META のカテゴリには calendar.css の .cat-xxx ブロックが必ずある", () => {
  /*
   * カテゴリを 1 つ足すのに触るファイルは 3 つある:
   *   categories.js（CAT_META） / tokens.css（--c-xxx の 3 値） /
   *   calendar.css（.cat-xxx が --bar / --bg / --tx を供給する）
   *
   * 3 つ目を忘れると、イベントブロックも終日ピルも詳細バッジも
   * 未定義のカスタムプロパティを参照して無色になる。JS 側は何も気付かない。
   */
  const calendar = readCss("calendar.css");
  for (const key of CAT_KEYS) {
    const block = new RegExp(`\\.${key}\\s*\\{([^}]*)\\}`).exec(calendar);
    assert.ok(block, `calendar.css に .${key} { … } がありません`);
    for (const [prop, token] of [
      ["--bar", `--c-${key.slice("cat-".length)}`],
      ["--bg", `--c-${key.slice("cat-".length)}-bg`],
      ["--tx", `--c-${key.slice("cat-".length)}-tx`],
    ]) {
      assert.match(
        block[1],
        new RegExp(`${prop}\\s*:\\s*var\\(\\s*${token}\\s*\\)`),
        `.${key} が ${prop}: var(${token}) を供給していません`
      );
    }
  }
});

test("calendar.css に CAT_META にないカテゴリのブロックが残っていない", () => {
  // 消したカテゴリの取り残しを拾う（逆向きのずれ）
  const calendar = readCss("calendar.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const declared = [...calendar.matchAll(/^\.(cat-[a-z0-9-]+)\s*\{/gm)].map((m) => m[1]);
  assert.ok(declared.length > 0, "calendar.css から .cat-xxx を 1 つも読み取れていません");
  for (const key of declared) {
    assert.ok(CAT_KEYS.includes(key), `calendar.css の .${key} は CAT_META にありません`);
  }
});

test("カテゴリの文字はティント地に対して十分な明暗差がある", () => {
  for (const c of CATEGORIES) {
    const ratio = contrast(T.get(`c-${c}-bg`), T.get(`c-${c}-tx`));
    assert.ok(ratio >= 7.0, `${c}: 文字のコントラストが ${ratio.toFixed(2)}（7.0 未満）`);
  }
});

test("カテゴリのアクセントはティント地に対して十分な明暗差がある", () => {
  for (const c of CATEGORIES) {
    const ratio = contrast(T.get(`c-${c}-bg`), T.get(`c-${c}`));
    assert.ok(ratio >= 4.5, `${c}: アクセントのコントラストが ${ratio.toFixed(2)}（4.5 未満）`);
  }
});

test("カテゴリのアクセントは白文字を載せられる", () => {
  // 地図ピンと詳細バッジはアクセント色のベタ塗りに白文字を置く
  for (const c of CATEGORIES) {
    const ratio = contrast(T.get(`c-${c}`), T.get("sand-lt"));
    assert.ok(ratio >= 4.5, `${c}: 反転文字のコントラストが ${ratio.toFixed(2)}（4.5 未満）`);
  }
});

test("ティント地どうしが見分けられる", () => {
  for (let i = 0; i < CATEGORIES.length; i++) {
    for (let j = i + 1; j < CATEGORIES.length; j++) {
      const a = T.get(`c-${CATEGORIES[i]}-bg`);
      const b = T.get(`c-${CATEGORIES[j]}-bg`);
      const d = distance(a, b);
      assert.ok(d >= 20, `${CATEGORIES[i]}/${CATEGORIES[j]}: 色距離が ${d.toFixed(0)}（20 未満）`);
    }
  }
});

test("ティント地がカレンダーの下地から浮き上がる", () => {
  for (const c of CATEGORIES) {
    const d = distance(T.get(`c-${c}-bg`), T.get("sand-lt"));
    assert.ok(d >= 25, `${c}: 下地との色距離が ${d.toFixed(0)}（25 未満）`);
  }
});

test("本文が主背景に対して十分な明暗差がある", () => {
  assert.ok(contrast(T.get("sand"), T.get("ink")) >= 7.0);
  assert.ok(contrast(T.get("sand"), T.get("ink-2")) >= 4.5);
});

test("--hour-h と calendar.js の HOUR_H が一致する", () => {
  // ずれると時間軸の目盛りとイベントブロックの高さが食い違う。
  // 4 つのドキュメントが「両方直すこと」と書いているだけで、
  // これまで機械的に確かめる手段が無かった。
  const js = readFileSync(new URL("../assets/js/calendar.js", import.meta.url), "utf8");
  const matched = /export const HOUR_H\s*=\s*(\d+(?:\.\d+)?)\s*;/.exec(js);
  assert.ok(matched, "calendar.js から HOUR_H を読み取れません");
  assert.equal(
    L.get("hour-h"),
    `${matched[1]}px`,
    `--hour-h が ${L.get("hour-h")} なのに HOUR_H は ${matched[1]} です`
  );
});

test("半透明用のチャンネルトークンが元の色と一致する", () => {
  // rgb(var(--ink-rgb) / 0.14) の形で使うため、--ink を変えたときに
  // 影だけ古い色のまま取り残されるのを防ぐ。
  for (const [channelName, hexName] of [["ink-rgb", "ink"], ["sand-lt-rgb", "sand-lt"]]) {
    const matched = new RegExp(`--${channelName}\\s*:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`).exec(css);
    assert.ok(matched, `--${channelName} が定義されていません`);
    const channels = matched.slice(1, 4).map(Number);
    assert.deepEqual(
      channels,
      rgb(T.get(hexName)),
      `--${channelName} が --${hexName}（${T.get(hexName)}）と一致しません`
    );
  }
});

test("tokens.css 以外の CSS に色リテラルを書かない", () => {
  // 「色は tokens.css だけ」は 4 つのドキュメントが宣言している約束。
  // スプライト側には icons.test.js の同種のガードがあるが、
  // CSS 側には無かったので 4 箇所すり抜けていた。
  const files = ["base.css", "controls.css", "calendar.css"];
  for (const name of files) {
    // コメント中の例示や出典メモは対象外
    const src = readCss(name).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${name}: 16進の色リテラルがあります`);
    // rgb(var(--ink-rgb) / 0.4) は許す。数値を直接書いた形だけを弾く
    assert.doesNotMatch(
      src,
      /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[\d.]/,
      `${name}: 数値を直接書いた色関数があります`
    );
  }
});

test("角丸トークンが5段階そろっている", () => {
  // css.includes() だとコメント内の文字列一致でも通ってしまうため、
  // 実際の宣言として値を持つかを readLengthTokens() のパース結果で検証する。
  for (const name of ["r-xs", "r-sm", "r-md", "r-lg", "r-pill"]) {
    assert.ok(L.has(name), `--${name} が宣言として定義されていません`);
  }
  // 999px のような3桁の値も正しく拾えることを確認する
  assert.equal(L.get("r-pill"), "999px", `--r-pill の値が想定と異なります: ${L.get("r-pill")}`);
});
