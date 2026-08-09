import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../assets/css/tokens.css", import.meta.url), "utf8");

function readTokens(src) {
  const map = new Map();
  for (const m of src.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    map.set(m[1], m[2].toUpperCase());
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
const CATEGORIES = ["move", "sight", "food", "hotel", "shop"];

test("基本トークンがすべて定義されている", () => {
  for (const name of ["sand", "sand-lt", "paper", "ink", "ink-2", "ink-3", "line",
                      "line-soft", "line-faint"]) {
    assert.ok(T.has(name), `--${name} が定義されていません`);
  }
});

test("カテゴリごとに3値が揃っている", () => {
  for (const c of CATEGORIES) {
    for (const suffix of ["", "-bg", "-tx"]) {
      const name = `c-${c}${suffix}`;
      assert.ok(T.has(name), `--${name} が定義されていません`);
    }
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

test("角丸トークンが5段階そろっている", () => {
  for (const name of ["--r-xs", "--r-sm", "--r-md", "--r-lg", "--r-pill"]) {
    assert.ok(css.includes(name), `${name} が定義されていません`);
  }
});
