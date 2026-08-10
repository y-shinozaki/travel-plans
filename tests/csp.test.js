import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// archive.html は取りやめた検索アーカイブの仮ページで、B4 で削除した（設計書 §2.1）
const PAGES = ["index.html", "schedule.html", "packing.html"];

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

function cspOf(html) {
  const m = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i.exec(html);
  return m ? m[1] : null;
}

function directive(csp, name) {
  const found = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + " "));
  return found ? found.slice(name.length + 1).trim().split(/\s+/) : null;
}

test("全ページに CSP がある", () => {
  for (const page of PAGES) {
    assert.ok(cspOf(read(page)), `${page} に CSP メタタグがありません`);
  }
});

test("script-src は self のみ。unsafe-inline も unsafe-eval も許さない", () => {
  for (const page of PAGES) {
    const src = directive(cspOf(read(page)), "script-src");
    assert.deepEqual(src, ["'self'"], `${page} の script-src が想定と違います`);
  }
});

test("インライン script が 1 つもない", () => {
  // script-src 'self' の下ではインライン script は実行されない。
  // 書いてあること自体が「動かないコードが残っている」印なので落とす。
  for (const page of PAGES) {
    const html = read(page);
    for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attrs, body] = tag;
      assert.match(attrs, /\bsrc=/, `${page} にインライン script があります: ${body.trim().slice(0, 60)}`);
      assert.equal(body.trim(), "", `${page} の script タグに中身があります`);
    }
  }
});

test("イベントハンドラ属性が 1 つもない", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${page} に on* 属性があります`);
  }
});

test("connect-src が GitHub API を許可している", () => {
  // 公開フローが api.github.com を叩く
  for (const page of PAGES) {
    const c = directive(cspOf(read(page)), "connect-src");
    assert.ok(c?.includes("https://api.github.com"), `${page} の connect-src に api.github.com がありません`);
  }
});

test("archive.html は残っていない", () => {
  assert.equal(existsSync(new URL("../archive.html", import.meta.url)), false);
});

test("地図タイルとフォントの取得元が許可されている", () => {
  const csp = cspOf(read("schedule.html"));
  // img-src は https: のワイルドカードで許可している（旅程データが複数の
  // 外部ホストから画像を直リンクしているため。設計書 §13 の負債）。
  // ホスト名を列挙する形に変えたなら、その並びに CartoDB が入っていること。
  const img = directive(csp, "img-src");
  assert.ok(
    img?.includes("https:") || img?.some((s) => s.includes("cartocdn.com")),
    `img-src が地図タイルを許可していません: ${img?.join(" ")}`
  );
  assert.ok(directive(csp, "font-src")?.some((s) => s.includes("fonts.gstatic.com")));
});
