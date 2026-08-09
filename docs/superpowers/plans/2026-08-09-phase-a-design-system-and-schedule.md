# Phase A: デザイン基盤と旅程ページ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 単一 `index.html`（2,521行）を、共通 CSS / JS を持つ複数ページ構成に分割し、旅程ページを新デザイン（aman.com 由来）で再構築する。

**Architecture:** ビルドツールなしの静的サイト。ロジックは ES モジュールに切り出し、純粋関数は Node 標準テストランナー（`node --test`、依存パッケージなし）で検証する。描画部分はブラウザで数値を測って確認する。イベントデータは HTML 埋め込みの JS 配列から `assets/data/events.json` へ移す。

**Tech Stack:** バニラ JS（ES モジュール）、CSS カスタムプロパティ、Leaflet 1.9.4（セルフホスト）、Google Fonts（Newsreader / Inter / Noto Sans JP / Noto Serif JP）、Node 26 の `node --test`

**参照資料:**
- 設計書: `docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md`
- デザインモック（検証済み・実装の見本）: `docs/design-reference/mock-aman.html`

このモックは実データを流し込んで動作確認済みのものです。CSS はここから抜き出して使います。行番号は本計画で指定します。

---

## Global Constraints

- **npm パッケージを追加しない。** `package.json` は `{"type":"module","private":true}` のみ。ビルドステップを作らない
- **ハードコードされた色を書かない。** 色はすべて `assets/css/tokens.css` の CSS 変数を参照する
- **角丸は `--r-xs` / `--r-sm` / `--r-md` / `--r-lg` / `--r-pill` のトークンのみ使う。** 生の px を書かない
- **`alert()` / `confirm()` / `prompt()` を使わない。** ページ全体をブロックするため。破壊的操作は2度押し、エラーはインライン表示
- **行間は 1.45 倍を基本とし、本文のみ 1.7 倍**
- **大文字化（`text-transform: uppercase`）は 10px・字間 2px のラベルにのみ適用する**
- **`prefers-reduced-motion: reduce` で全アニメーションを無効化する**
- UI の文言はすべて日本語
- JS は `<script type="module">` で読み込む。`file://` では動かないため、動作確認は必ず `python3 -m http.server 8000` 経由で行う
- テストは `node --test` で実行する
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける

---

## File Structure

| ファイル | 責務 |
|---|---|
| `package.json` | `type: module` の宣言のみ。依存なし |
| `assets/js/time.js` | 10進時間 ⇄ `HH:MM` の変換、表示ラベル生成 |
| `assets/js/events.js` | イベントの正規化と、日をまたぐイベントの日別セグメント展開 |
| `assets/js/lanes.js` | 同時刻に重なるイベントのレーン割り当て |
| `assets/js/icons.js` | インライン SVG スプライトの定義と注入、`<use>` 参照の生成 |
| `assets/js/reveal.js` | スクロール連動の出現演出（取りこぼし対策の掃引つき） |
| `assets/js/nav.js` | ページ間ナビゲーションの生成 |
| `assets/js/calendar.js` | カレンダーグリッドの描画（状態は持たない） |
| `assets/js/map.js` | Leaflet 地図とロケーション一覧の描画 |
| `assets/js/sheet.js` | 右から出るシート（開閉・フォーカス・Esc） |
| `assets/js/schedule.js` | 旅程ページの状態保持と各モジュールの結線 |
| `assets/js/menu.js` | メニューページの結線 |
| `assets/css/tokens.css` | 色・余白・角丸・書体・モーションの変数定義 |
| `assets/css/base.css` | リセット、タイポグラフィ、共通レイアウト、モーション |
| `assets/css/controls.css` | ボタン、チップ、入力欄、シート |
| `assets/css/calendar.css` | カレンダーと地図 |
| `assets/data/events.json` | 旅行日と旅程イベント |
| `assets/vendor/leaflet/` | Leaflet 1.9.4 の JS / CSS / 画像 |
| `tools/extract-events.mjs` | 旧 `index.html` からイベントを抽出して JSON 化する一度きりのスクリプト |
| `tests/*.test.js` | 純粋関数のテスト |
| `index.html` | メニュー |
| `schedule.html` | 旅程 |
| `packing.html` / `archive.html` | Phase B / C 用のスタブ |

---

## Task 1: テスト基盤と時刻ユーティリティ

**Files:**
- Create: `package.json`
- Create: `assets/js/time.js`
- Test: `tests/time.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `decToHHMM(dec: number): string` — `12.5` → `"12:30"`
  - `hhmmToDec(s: string): number` — `"12:30"` → `12.5`
  - `timeLabel(ev: {allDay?: boolean, start?: number, end?: number}): string` — `"10:35 → 15:05"` または `"終日"`

- [ ] **Step 1: `package.json` を作る**

`node --test` が `assets/js/*.js` を ES モジュールとして読み込めるようにするためだけのファイル。依存は入れない。

```json
{
  "name": "travel-plans",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/time.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { decToHHMM, hhmmToDec, timeLabel } from "../assets/js/time.js";

test("decToHHMM は10進時間を HH:MM に変換する", () => {
  assert.equal(decToHHMM(0), "00:00");
  assert.equal(decToHHMM(12.5), "12:30");
  assert.equal(decToHHMM(9), "09:00");
  // 実データの値。0.08 * 60 = 4.8 → 5 分に丸める
  assert.equal(decToHHMM(15.08), "15:05");
  assert.equal(decToHHMM(10.58), "10:35");
});

test("decToHHMM は分が60に丸まったとき時に繰り上げる", () => {
  assert.equal(decToHHMM(9.999), "10:00");
  assert.equal(decToHHMM(23.999), "24:00");
});

test("decToHHMM は数値以外を拒否する", () => {
  assert.throws(() => decToHHMM("12:30"), TypeError);
  assert.throws(() => decToHHMM(NaN), TypeError);
  assert.throws(() => decToHHMM(undefined), TypeError);
});

test("hhmmToDec は HH:MM を10進時間に変換する", () => {
  assert.equal(hhmmToDec("00:00"), 0);
  assert.equal(hhmmToDec("12:30"), 12.5);
  assert.equal(hhmmToDec("9:05"), 9 + 5 / 60);
});

test("hhmmToDec は不正な形式を拒否する", () => {
  assert.throws(() => hhmmToDec("1230"), TypeError);
  assert.throws(() => hhmmToDec(""), TypeError);
  assert.throws(() => hhmmToDec("25:00"), RangeError);
  assert.throws(() => hhmmToDec("12:60"), RangeError);
});

test("decToHHMM と hhmmToDec は往復して一致する", () => {
  for (const s of ["00:00", "07:45", "10:35", "15:05", "23:55"]) {
    assert.equal(decToHHMM(hhmmToDec(s)), s);
  }
});

test("timeLabel は終日と時刻つきを出し分ける", () => {
  assert.equal(timeLabel({ allDay: true }), "終日");
  assert.equal(timeLabel({ start: 10.58, end: 15.08 }), "10:35 → 15:05");
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `node --test tests/time.test.js`
Expected: FAIL。`Cannot find module .../assets/js/time.js` で全件失敗する。

- [ ] **Step 4: 実装する**

`assets/js/time.js`:

```js
/**
 * 旅程データは時刻を10進時間で持つ（12.5 = 12:30）。
 * 表示用の文字列は保持せず、必要なときにここで生成する。
 */

export function decToHHMM(dec) {
  if (typeof dec !== "number" || !Number.isFinite(dec)) {
    throw new TypeError(`decToHHMM: 有限の数値ではありません: ${dec}`);
  }
  let h = Math.floor(dec);
  let m = Math.round((dec - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToDec(s) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!matched) {
    throw new TypeError(`hhmmToDec: HH:MM 形式ではありません: ${s}`);
  }
  const h = Number(matched[1]);
  const m = Number(matched[2]);
  if (h > 24) throw new RangeError(`hhmmToDec: 時が範囲外です: ${s}`);
  if (m > 59) throw new RangeError(`hhmmToDec: 分が範囲外です: ${s}`);
  return h + m / 60;
}

export function timeLabel(ev) {
  if (ev.allDay) return "終日";
  return `${decToHHMM(ev.start)} → ${decToHHMM(ev.end)}`;
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `node --test tests/time.test.js`
Expected: PASS。7 件すべて成功。

- [ ] **Step 6: コミット**

```bash
git add package.json assets/js/time.js tests/time.test.js
git commit -m "$(cat <<'EOF'
Add time conversion helpers and Node test setup

The itinerary stores times as decimal hours (12.5 = 12:30). Display
strings are generated on demand rather than stored, so the two cannot
drift apart.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: イベントデータの抽出と JSON 化

**Files:**
- Create: `tools/extract-events.mjs`
- Create: `assets/data/events.json`（スクリプトが生成する）

**Interfaces:**
- Consumes: なし
- Produces: `assets/data/events.json` — 形は下記のとおり。Task 3 以降がこの形を前提にする

```jsonc
{
  "updatedAt": "2026-08-09T...+09:00",
  "days": [{ "dow": "水", "date": "8/12" }, ...],   // 6 件
  "events": [
    {
      "id": "ev-001",
      "cat": "cat-move",
      "title": "出国フライト（依田家）",
      "allDay": false,
      "startDay": 0,
      "endDay": 0,
      "start": 10.58,
      "end": 15.08,
      "location": "スワンナプーム国際空港",
      "lat": 13.69,
      "lng": 100.7501,
      "url": "",
      "notes": "便名: タイ国際航空 TG683 (HND→BKK)\n所要時間: 6時間30分",
      "image": "",
      "imagePos": ""
      // "icon" はカテゴリ既定と異なるときのみ付く
    }
  ]
}
```

現行 `index.html` の `events` 配列は 3 つの形式が混在している（`d` を持つ単日、`multiDay: true`、`allDay: true`）。これを `startDay` / `endDay` に統一する。

- [ ] **Step 1: 抽出スクリプトを書く**

`tools/extract-events.mjs`:

```js
/**
 * 旧 index.html に埋め込まれた days / events 配列を assets/data/events.json へ移す。
 * 一度きりの移行スクリプト。移行後は実行する必要はないが、
 * 手作業での書き写しミスを避けるために残しておく。
 *
 * 実行: node tools/extract-events.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runInNewContext } from "node:vm";

const SRC = "index.html";
const OUT = "assets/data/events.json";

/**
 * Material Symbols 名 → スプライトの symbol id。
 * 左辺は現行 index.html に実在する 9 種類すべて。
 * 未知の名前が来たら警告を出してカテゴリ既定に落とす。
 */
const ICON_MAP = {
  flight: "i-flight",
  photo_camera: "i-camera",
  restaurant: "i-food",
  hotel: "i-hotel",
  shopping_bag: "i-shop",
  directions_car: "i-car",
  directions_boat: "i-boat",
  pool: "i-pool",
  luggage: "i-luggage",
};

const CAT_DEFAULT_ICON = {
  "cat-move": "i-flight",
  "cat-sight": "i-camera",
  "cat-food": "i-food",
  "cat-hotel": "i-hotel",
  "cat-shop": "i-shop",
};

/**
 * `const <name> = [` の直後から対応する `]` までを切り出す。
 * 文字列リテラルの中の括弧を数えないよう、クォートの状態を追う。
 */
function sliceArrayLiteral(src, name) {
  const decl = src.indexOf(`const ${name} = [`);
  if (decl === -1) throw new Error(`${name} の宣言が見つかりません`);
  const from = src.indexOf("[", decl);

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  throw new Error(`${name} の終端 ] が見つかりません`);
}

const html = readFileSync(SRC, "utf8");
const days = runInNewContext(sliceArrayLiteral(html, "days"));

// 切り出しが途中で終わっていないかを独立した方法で照合する。
// 括弧の数え間違いで配列が黙って短くなるのが一番怖い失敗なので、
// テキスト中の title: の出現数とパース結果の件数が一致することを確かめる。
const eventsSource = sliceArrayLiteral(html, "events");
const rawEvents = runInNewContext(eventsSource);
const titleOccurrences = (eventsSource.match(/\btitle:\s*"/g) ?? []).length;
if (titleOccurrences !== rawEvents.length) {
  throw new Error(
    `切り出しが不完全です: title の出現数 ${titleOccurrences} に対し ${rawEvents.length} 件しかパースできていません`
  );
}

const warnings = [];

const events = rawEvents.map((e, i) => {
  const startDay = e.multiDay ? e.startDay : e.d;
  const endDay = e.multiDay ? e.endDay : e.d;

  if (typeof startDay !== "number" || typeof endDay !== "number") {
    throw new Error(`${i} 件目 "${e.title}" の日付を決められません`);
  }

  // 緯度と経度は両方揃っているときだけ採用する
  const hasCoords = e.lat != null && e.lng != null;

  const out = {
    id: `ev-${String(i + 1).padStart(3, "0")}`,
    cat: e.cat,
    title: e.title,
    allDay: !!e.allDay,
    startDay,
    endDay,
    location: e.location ?? "",
    lat: hasCoords ? e.lat : null,
    lng: hasCoords ? e.lng : null,
    url: e.url ?? "",
    notes: e.notes ?? "",
    image: e.image ?? "",
    imagePos: e.imagePos ?? "",
  };

  if (!out.allDay) {
    out.start = e.multiDay ? e.startHour : e.start;
    out.end = e.multiDay ? e.endHour : e.end;
    if (typeof out.start !== "number" || typeof out.end !== "number") {
      throw new Error(`${i} 件目 "${e.title}" の時刻を決められません`);
    }
  }

  // アイコンはカテゴリ既定と異なるときだけ持たせる
  if (e.icon) {
    const mapped = ICON_MAP[e.icon];
    if (!mapped) {
      warnings.push(`未知のアイコン "${e.icon}"（${e.title}）→ カテゴリ既定にします`);
    } else if (mapped !== CAT_DEFAULT_ICON[e.cat]) {
      out.icon = mapped;
    }
  }

  return out;
});

const payload = {
  updatedAt: new Date().toISOString(),
  days,
  events,
};

mkdirSync("assets/data", { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");

for (const w of warnings) console.warn("警告:", w);
console.log(`${OUT} を書き出しました: ${days.length} 日, ${events.length} 件`);
console.log(`  終日: ${events.filter((e) => e.allDay).length} 件`);
console.log(`  日またぎ: ${events.filter((e) => e.endDay > e.startDay).length} 件`);
console.log(`  座標あり: ${events.filter((e) => e.lat != null).length} 件`);
```

- [ ] **Step 2: 実行して結果を確認する**

Run: `node tools/extract-events.mjs`

Expected: エラーなく完了し、次のとおり出る。この数字は現行 `index.html` を実測した値。

```
assets/data/events.json を書き出しました: 6 日, 40 件
  終日: 5 件
  日またぎ: 3 件
  座標あり: 21 件
```

警告が出ないこと（`ICON_MAP` は実在する 9 種類をすべて網羅している）。

**件数が合わないまま先へ進まない。** 違っていたら現行データを読み直して原因を特定すること。

- [ ] **Step 3: 生成された JSON を目視で検証する**

Run:

```bash
node -e '
const d = JSON.parse(require("fs").readFileSync("assets/data/events.json","utf8"));
console.log("日数:", d.days.length);
console.log("日またぎ:", d.events.filter(e=>e.endDay>e.startDay).map(e=>`${e.title} ${e.startDay}→${e.endDay} ${e.start}-${e.end}`));
console.log("start/end 欠落:", d.events.filter(e=>!e.allDay && (e.start==null||e.end==null)).map(e=>e.title));
console.log("片側だけ座標:", d.events.filter(e=>(e.lat==null)!==(e.lng==null)).map(e=>e.title));
console.log("cat 欠落:", d.events.filter(e=>!e.cat).map(e=>e.title));
console.log("id 重複:", d.events.length - new Set(d.events.map(e=>e.id)).size);
console.log("座標の重複排除後:", new Set(d.events.filter(e=>e.lat!=null).map(e=>e.lat+","+e.lng)).size);
'
```

Expected:
- 日数: 6
- 日またぎ: 次の 3 件がこの値で出ること
  - `バンコクホテル 0→2 15-11`
  - `パタヤホテル 2→4 14-12`
  - `帰国フライト（依田家） 4→5 22.17-6.33`
- `start/end 欠落`、`片側だけ座標`、`cat 欠落` はいずれも空配列
- `id 重複`: 0
- `座標の重複排除後`: 17 — これが地図に立つピンの数になる（Task 10 の期待値）

- [ ] **Step 4: コミット**

```bash
git add tools/extract-events.mjs assets/data/events.json
git commit -m "$(cat <<'EOF'
Extract itinerary data from index.html into events.json

The old inline array mixed three shapes (single-day `d`, `multiDay`,
`allDay`). They are unified on startDay/endDay so rendering has one
code path. The extraction script is kept so the conversion can be
re-run and audited rather than trusted as a hand copy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: イベント展開ロジック

**Files:**
- Create: `assets/js/events.js`
- Test: `tests/events.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `expandEvents(events: Event[], dayCount: number): Segment[]`
  - `Segment` = `{ ref: Event, day: number, allDay: boolean, start: number, end: number, isFirst: boolean, isLast: boolean }`
  - `hasCoords(ev: Event): boolean`
  - `collectLocations(events: Event[], catFilter: string|null): Event[]` — 座標を持つイベントを座標で重複排除して返す

日をまたぐイベントは、開始日は `start`〜24 時、中間日は 0〜24 時、終了日は 0〜`end` に割る。実体は 1 件のままで、`ref` が元のイベントを指す。

- [ ] **Step 1: 失敗するテストを書く**

`tests/events.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { expandEvents, hasCoords, collectLocations } from "../assets/js/events.js";

const timed = (over = {}) => ({
  id: "e1", cat: "cat-food", title: "昼食",
  allDay: false, startDay: 1, endDay: 1, start: 12, end: 13, ...over,
});

test("単日イベントは1セグメントになる", () => {
  const segs = expandEvents([timed()], 6);
  assert.equal(segs.length, 1);
  assert.deepEqual(
    { day: segs[0].day, start: segs[0].start, end: segs[0].end,
      isFirst: segs[0].isFirst, isLast: segs[0].isLast },
    { day: 1, start: 12, end: 13, isFirst: true, isLast: true }
  );
  assert.equal(segs[0].ref.id, "e1");
});

test("日をまたぐイベントは日ごとに割られる", () => {
  // 8/12 15:00 → 8/14 11:00 のホテル滞在
  const segs = expandEvents([timed({ startDay: 0, endDay: 2, start: 15, end: 11 })], 6);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map((s) => [s.day, s.start, s.end]), [
    [0, 15, 24],
    [1, 0, 24],
    [2, 0, 11],
  ]);
  assert.deepEqual(segs.map((s) => s.isFirst), [true, false, false]);
  assert.deepEqual(segs.map((s) => s.isLast), [false, false, true]);
});

test("すべてのセグメントが同じ実体を指す", () => {
  const ev = timed({ startDay: 0, endDay: 2, start: 15, end: 11 });
  const segs = expandEvents([ev], 6);
  assert.ok(segs.every((s) => s.ref === ev));
});

test("表示日数を超える分は切り捨てる", () => {
  const segs = expandEvents([timed({ startDay: 4, endDay: 9, start: 9, end: 10 })], 6);
  assert.deepEqual(segs.map((s) => s.day), [4, 5]);
});

test("終日イベントは0〜24として展開される", () => {
  const segs = expandEvents([{ id: "a", allDay: true, startDay: 2, endDay: 2 }], 6);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].allDay, true);
  assert.deepEqual([segs[0].start, segs[0].end], [0, 24]);
});

test("endDay が startDay より前でも1セグメントに落とす", () => {
  const segs = expandEvents([timed({ startDay: 3, endDay: 1 })], 6);
  assert.deepEqual(segs.map((s) => s.day), [3]);
});

test("hasCoords は両方揃ったときだけ true", () => {
  assert.equal(hasCoords({ lat: 13.7, lng: 100.5 }), true);
  assert.equal(hasCoords({ lat: 13.7, lng: null }), false);
  assert.equal(hasCoords({ lat: null, lng: 100.5 }), false);
  assert.equal(hasCoords({}), false);
  assert.equal(hasCoords({ lat: 0, lng: 0 }), true);
});

test("collectLocations は同一座標を1件にまとめる", () => {
  const evs = [
    { id: "a", cat: "cat-move", lat: 13.69, lng: 100.75 },
    { id: "b", cat: "cat-move", lat: 13.69, lng: 100.75 },
    { id: "c", cat: "cat-food", lat: 13.73, lng: 100.56 },
    { id: "d", cat: "cat-food", lat: null, lng: null },
  ];
  assert.deepEqual(collectLocations(evs, null).map((e) => e.id), ["a", "c"]);
});

test("collectLocations はカテゴリで絞り込める", () => {
  const evs = [
    { id: "a", cat: "cat-move", lat: 13.69, lng: 100.75 },
    { id: "c", cat: "cat-food", lat: 13.73, lng: 100.56 },
  ];
  assert.deepEqual(collectLocations(evs, "cat-food").map((e) => e.id), ["c"]);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/events.test.js`
Expected: FAIL。`Cannot find module .../assets/js/events.js`。

- [ ] **Step 3: 実装する**

`assets/js/events.js`:

```js
/**
 * イベントの実体は1件のまま、描画のために日ごとのセグメントへ割る。
 * セグメントは ref で元のイベントを指すので、編集や削除は実体に対して行える。
 */

export function expandEvents(events, dayCount) {
  const out = [];
  for (const ev of events) {
    const first = ev.startDay;
    const last = Math.max(ev.endDay ?? first, first);
    for (let day = first; day <= last && day < dayCount; day++) {
      const isFirst = day === first;
      const isLast = day === last;
      out.push({
        ref: ev,
        day,
        allDay: !!ev.allDay,
        start: ev.allDay ? 0 : isFirst ? ev.start : 0,
        end: ev.allDay ? 24 : isLast ? ev.end : 24,
        isFirst,
        isLast,
      });
    }
  }
  return out;
}

export function hasCoords(ev) {
  return ev.lat != null && ev.lng != null;
}

export function collectLocations(events, catFilter) {
  const seen = new Map();
  for (const ev of events) {
    if (!hasCoords(ev)) continue;
    if (catFilter && ev.cat !== catFilter) continue;
    const key = `${ev.lat},${ev.lng}`;
    if (!seen.has(key)) seen.set(key, ev);
  }
  return [...seen.values()];
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/events.test.js`
Expected: PASS。9 件すべて成功。

- [ ] **Step 5: コミット**

```bash
git add assets/js/events.js tests/events.test.js
git commit -m "$(cat <<'EOF'
Add event expansion and location collection

Multi-day events are split into per-day segments for rendering while
each segment keeps a reference to the single underlying event, so
edits and deletes act on one record.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: レーン配置ロジック

**Files:**
- Create: `assets/js/lanes.js`
- Test: `tests/lanes.test.js`

**Interfaces:**
- Consumes: `Segment`（Task 3）
- Produces: `assignLanes(segments: Segment[]): Segment[]` — 各要素に `lane: number` と `laneCount: number` を書き足した新しい配列を、開始時刻順で返す

同じ列（同じ日）の中で時間が重なるイベントを横に並べるための割り当て。`laneCount` はその日の最大レーン数で、全セグメントに同じ値が入る（列幅を揃えるため）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/lanes.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { assignLanes } from "../assets/js/lanes.js";

const seg = (start, end, id) => ({ id, start, end });

test("重ならないイベントはすべて同じレーンに入る", () => {
  const out = assignLanes([seg(9, 10, "a"), seg(11, 12, "b"), seg(13, 14, "c")]);
  assert.deepEqual(out.map((s) => s.lane), [0, 0, 0]);
  assert.deepEqual(out.map((s) => s.laneCount), [1, 1, 1]);
});

test("終わりと始まりが接するイベントは同じレーンに入る", () => {
  const out = assignLanes([seg(9, 10, "a"), seg(10, 11, "b")]);
  assert.deepEqual(out.map((s) => s.lane), [0, 0]);
  assert.deepEqual(out.map((s) => s.laneCount), [1, 1]);
});

test("重なるイベントは別レーンに分かれる", () => {
  const out = assignLanes([seg(9, 12, "a"), seg(10, 11, "b")]);
  assert.deepEqual(out.map((s) => [s.id, s.lane]), [["a", 0], ["b", 1]]);
  assert.deepEqual(out.map((s) => s.laneCount), [2, 2]);
});

test("3件が重なると3レーンになる", () => {
  const out = assignLanes([seg(9, 12, "a"), seg(9.5, 12, "b"), seg(10, 12, "c")]);
  assert.deepEqual(out.map((s) => s.lane), [0, 1, 2]);
  assert.ok(out.every((s) => s.laneCount === 3));
});

test("空いたレーンは再利用される", () => {
  // a と b が重なり、a が終わったあとの c は a のレーンに戻る
  const out = assignLanes([seg(9, 10, "a"), seg(9.5, 13, "b"), seg(10.5, 11, "c")]);
  const byId = Object.fromEntries(out.map((s) => [s.id, s.lane]));
  assert.equal(byId.a, 0);
  assert.equal(byId.b, 1);
  assert.equal(byId.c, 0);
  assert.ok(out.every((s) => s.laneCount === 2));
});

test("入力順に関わらず開始時刻順で返る", () => {
  const out = assignLanes([seg(13, 14, "c"), seg(9, 10, "a"), seg(11, 12, "b")]);
  assert.deepEqual(out.map((s) => s.id), ["a", "b", "c"]);
});

test("元の配列を書き換えない", () => {
  const input = [seg(9, 10, "a")];
  assignLanes(input);
  assert.equal("lane" in input[0], false);
});

test("空配列を渡しても落ちない", () => {
  assert.deepEqual(assignLanes([]), []);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/lanes.test.js`
Expected: FAIL。`Cannot find module .../assets/js/lanes.js`。

- [ ] **Step 3: 実装する**

`assets/js/lanes.js`:

```js
/**
 * 同じ日の中で時間が重なるイベントを横に並べるためのレーン割り当て。
 * laneCount はその日の最大レーン数で、全セグメントに同じ値を入れる。
 * 列幅を揃えないと、隣り合うイベントの幅がばらついて読みにくくなるため。
 */

export function assignLanes(segments) {
  const sorted = segments
    .map((s) => ({ ...s }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const laneEnds = [];
  for (const s of sorted) {
    // 終了時刻が開始時刻以下なら空いているとみなす（接するだけなら同居できる）
    let lane = laneEnds.findIndex((end) => end <= s.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.end);
    } else {
      laneEnds[lane] = s.end;
    }
    s.lane = lane;
  }

  const laneCount = Math.max(laneEnds.length, 1);
  for (const s of sorted) s.laneCount = laneCount;
  return sorted;
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/lanes.test.js`
Expected: PASS。8 件すべて成功。

- [ ] **Step 5: 全テストを実行する**

Run: `node --test`
Expected: PASS。Task 1・3・4 の 24 件すべて成功。

- [ ] **Step 6: コミット**

```bash
git add assets/js/lanes.js tests/lanes.test.js
git commit -m "$(cat <<'EOF'
Add lane assignment for overlapping calendar events

laneCount is the per-day maximum rather than a per-event value so
adjacent blocks keep a consistent width.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: デザイントークンと数値テスト、DESIGN.md 刷新

**Files:**
- Create: `assets/css/tokens.css`
- Test: `tests/tokens.test.js`
- Modify: `DESIGN.md`（全面差し替え）

**Interfaces:**
- Consumes: なし
- Produces: CSS カスタムプロパティ。以降のすべての CSS がこれを参照する

カテゴリ色は「アクセント（`--c-X`）／ティント地（`--c-X-bg`）／文字（`--c-X-tx`）」の 3 値セット。低彩度の濃色をベタ塗りで並べると混色して濁るため、面はティントで塗り、識別は縦バーとアイコンに任せる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/tokens.test.js`。CSS をテキストとして読み、カスタムプロパティを取り出して、コントラスト比と色距離を数値で検証する。ブラウザは不要。

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/tokens.test.js`
Expected: FAIL。`ENOENT: no such file or directory ... tokens.css`。

- [ ] **Step 3: `assets/css/tokens.css` を作る**

```css
/*
 * デザイントークン
 * 出典: aman.com の computed style 実測値（2026-08-09 取得）
 * 詳細は DESIGN.md を参照。
 *
 * 色をハードコードしないこと。色の変更はこのファイルだけで完結させる。
 */
:root {
  /* ── Surface ───────────────────────────────
     Aman は純白を主背景に使わない */
  --sand: #f3eee7;      /* 主背景 */
  --sand-lt: #fdf9f5;   /* 副背景・カード面 */
  --paper: #ffffff;     /* 入力欄など、最前面 */
  --ink: #313131;       /* 本文・濃色面 */
  --ink-2: #585858;     /* 副次テキスト */
  --ink-3: #404040;     /* 濃色パネル */
  --line: #aaa6a3;      /* 罫線（強） */
  --line-soft: #ddd7ce; /* 罫線（中） */
  --line-faint: #e8e2d9;/* 罫線（弱） */
  --reverse: #f3eee7;   /* 濃色面上の文字 */

  /* ── Category ──────────────────────────────
     アクセント / ティント地 / 文字 の3値セット。
     低彩度の濃色をベタ塗りで並べると混色して濁るため、
     面はティントで塗り、識別は縦バーとアイコンに任せる。 */
  --c-move: #3f5c50;
  --c-move-bg: #d6e8db;
  --c-move-tx: #22352d;

  --c-sight: #7e5318;
  --c-sight-bg: #f6e7c0;
  --c-sight-tx: #4a3212;

  --c-food: #a54a2c;
  --c-food-bg: #f9e2d7;
  --c-food-tx: #58281a;

  --c-hotel: #2f566f;
  --c-hotel-bg: #d8e6f4;
  --c-hotel-tx: #1c3446;

  --c-shop: #6a4c78;
  --c-shop-bg: #ede2f2;
  --c-shop-tx: #38263f;

  /* ── Type ──────────────────────────────────
     Lyon / Whitney は有償のため無料の近似で置き換えている */
  --serif: "Newsreader", "Noto Serif JP", "Times New Roman", serif;
  --sans: "Inter", "Noto Sans JP", sans-serif;

  /* ── Space ─────────────────────────────────
     Aman の 14px グリッドを維持したまま拡大 */
  --s1: 7px;
  --s2: 14px;
  --s3: 28px;
  --s4: 42px;
  --s5: 56px;
  --s6: 84px;
  --s7: 112px;
  --s8: 154px;  /* セクション間。モバイルでは 96px に縮める */
  --s9: 210px;
  --gut: clamp(20px, 5vw, 84px);
  --maxw: 1440px;

  /* ── Radius ────────────────────────────────
     Aman は全要素 0px だが、柔らかさを出すため導入した意図的な逸脱 */
  --r-xs: 5px;    /* イベントブロック、終日ピル、チェックボックス */
  --r-sm: 8px;    /* サムネイル、入力欄 */
  --r-md: 12px;   /* 中サイズの面 */
  --r-lg: 18px;   /* カレンダー、地図、カード、パネル、テーブル */
  --r-pill: 999px;/* ボタン、チップ、バッジ、地図ピン */

  /* ── Motion ────────────────────────────────*/
  --e-out: cubic-bezier(0.22, 1, 0.36, 1);
  --e-io: cubic-bezier(0.65, 0, 0.35, 1);
  --t-fast: 0.32s;
  --t-mid: 0.55s;
  --t-slow: 0.9s;

  /* ── Calendar ──────────────────────────────*/
  --hour-h: 44px;  /* 1時間あたりの高さ。calendar.js の HOUR_H と一致させること */
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/tokens.test.js`
Expected: PASS。9 件すべて成功。

失敗した場合は色の値を調整して再実行する。**しきい値を下げて通さないこと。**

- [ ] **Step 5: `DESIGN.md` を書き換える**

現行の内容（代官山 蔦屋書店）は全部捨てて、次の構成で書き直す。

必須の見出しと内容:

1. **出典** — aman.com、2026-08-09 に computed style を取得
2. **Visual Theme** — 無彩色基調、写真主役、極端な余白、行間 1.45 の一貫、大文字化は最小ラベルのみ
3. **Color Palette** — `tokens.css` の全トークンを表で列挙。実測値と派生値を区別して書く
4. **Category Colors** — 3値セットの考え方と、ベタ塗りを避けた理由。検証値（文字コントラスト 9.7〜11.1、アクセント 4.7〜6.2、ティント間距離 21 以上）を明記
5. **Typography** — Lyon → Newsreader、Whitney → Inter の代替表。実測のタイプスケール（10.1px/ls2px のラベル、13px、14px/ls0.8px、19.6px/ls0.98px、31.08px/ls0.5px）と行間 1.45
6. **Spacing** — 14px グリッドと `--s1`〜`--s9`、`--gut`
7. **Radius** — Aman が 0px であることと、本プロジェクトで意図的に逸脱したこと、5段階の使い分け
8. **Motion** — 各演出の対象・時間・イージング、`prefers-reduced-motion` 対応
9. **Icons** — インライン SVG、線幅 1.0〜1.4px、`currentColor` 追従
10. **参照実装** — `docs/design-reference/mock-aman.html`

冒頭に次の一文を入れること:

> ハードコードされた 16 進数値をコードに書かないでください。色は必ず `assets/css/tokens.css` の CSS 変数を参照してください。

- [ ] **Step 6: コミット**

```bash
git add assets/css/tokens.css tests/tokens.test.js DESIGN.md
git commit -m "$(cat <<'EOF'
Replace design tokens with an Aman-derived palette

Category colours are now accent/tint/text triples. Solid low-chroma
fills muddied each other when tiled across the calendar, so the
surface carries a tint and the accent moves to a rule and icon.

tokens.test.js reads the stylesheet and asserts the contrast ratios
and colour distances numerically, so a future palette edit that
harms legibility fails the test rather than shipping.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ベース CSS・コントロール CSS・スクロール演出

**Files:**
- Create: `assets/css/base.css`
- Create: `assets/css/controls.css`
- Create: `assets/js/reveal.js`
- Reference: `docs/design-reference/mock-aman.html`

**Interfaces:**
- Consumes: `tokens.css` の変数
- Produces:
  - CSS クラス: `.eyebrow` `.display` `.h2` `.h3` `.body` `.micro` `.num` `.wrap` `.hairline` `.shead` `.reveal` `.lines` `.drawline` `.btn` `.chip` `.swipe` `.tbtn` `.rowbtn` `.inp` `.sheet` ほか
  - `initReveal(root = document): void` — `.reveal` / `.lines` / `.drawline` を監視して `is-in` を付ける

- [ ] **Step 1: `assets/css/base.css` を作る**

`docs/design-reference/mock-aman.html` の次のブロックをそのまま写す。

| 元の行 | 内容 |
|---|---|
| 82–203 | BASE（リセット、`body`、`.ico`、タイプロール） |
| 204–291 | MOTION（`@keyframes`、`.reveal`、`.lines`、`.drawline`、`prefers-reduced-motion`） |
| 540–592 のうち `.wrap` | 中央寄せコンテナ |
| 593–640 のうち `.sec` `.shead` `.hairline` | セクション見出しレイアウト |

写すときの変更点:

1. 先頭に `@import` は書かない。HTML 側で `tokens.css` → `base.css` の順に `<link>` する
2. `:root { ... }` のブロックは含めない（`tokens.css` にある）
3. `.mocknav` `.screen__tag` `.progressbar` `.mockfoot` は**含めない**（モック閲覧用のため）
4. `* { border-radius: 0 }` は**含めない**（モックの現行版では既に削除済み）

- [ ] **Step 2: `assets/css/controls.css` を作る**

同じくモックから写す。

| 元の行 | 内容 |
|---|---|
| 292–475 | CONTROLS（`.btn` `.chip` `.swipe` `.check`） |
| 1224–1406 | EVENT SHEET（`.sheet-overlay` `.sheet` `.field2` `.fgrid` `.ferror` `.catpick`） |
| 1606–1660 のうち `.tbtn` | ツールバーボタン |
| 1780–1860 のうち `.rowbtn` `.inp` | 行アクションと入力欄 |

`.catpick` と `.check` は Phase B で使うが、シートと同じファイルにあるほうが探しやすいのでここで入れておく。

- [ ] **Step 3: `assets/js/reveal.js` を作る**

```js
/**
 * スクロール連動の出現演出。
 *
 * IntersectionObserver 単体では、アンカージャンプやスクロール位置の復元で
 * 要素をひとまたぎしたときに is-in が付かず、コンテンツが opacity: 0 のまま
 * 永久に残る。threshold を 0 にしたうえで、スクロール時の掃引を併用する。
 */

export function initReveal(root = document) {
  const pending = new Set(root.querySelectorAll(".reveal, .lines, .drawline"));
  if (!pending.size) return () => {};

  const show = (node) => {
    if (!pending.has(node)) return;
    node.classList.add("is-in");
    pending.delete(node);
    observer.unobserve(node);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) show(entry.target);
    },
    { threshold: 0, rootMargin: "0px 0px -40px 0px" }
  );
  for (const node of pending) observer.observe(node);

  // 取りこぼしの掃引。ビューポート下端より上に来た要素は無条件で表示する
  const sweep = () => {
    if (!pending.size) return;
    for (const node of [...pending]) {
      if (node.getBoundingClientRect().top < window.innerHeight - 40) show(node);
    }
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      sweep();
      ticking = false;
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", sweep, { passive: true });
  window.addEventListener("load", sweep);
  sweep();

  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", sweep);
    window.removeEventListener("load", sweep);
  };
}
```

- [ ] **Step 4: 注意点を確認する**

**`reveal` と `drawline` を同じ要素に付けてはいけない。** CSS の `animation` プロパティが後勝ちで上書きされ、`.reveal` の `opacity: 0` が解除されないまま残る。罫線を引きたい要素には `drawline` だけを付ける。

CSS にこのコメントを残すこと（`base.css` の `.drawline` の直前）:

```css
/* reveal（フェード）と drawline（罫線を引く）を同一要素に付けないこと。
   animation プロパティが後勝ちで上書きされ、要素が不可視のまま残る。 */
```

- [ ] **Step 5: コミット**

```bash
git add assets/css/base.css assets/css/controls.css assets/js/reveal.js
git commit -m "$(cat <<'EOF'
Add base styles, controls and scroll reveal

initReveal pairs an IntersectionObserver with a scroll sweep. The
observer alone leaves content stuck at opacity 0 when an anchor jump
or a restored scroll position steps over an element in one frame.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: SVG スプライト

**Files:**
- Create: `assets/js/icons.js`
- Test: `tests/icons.test.js`
- Reference: `docs/design-reference/mock-aman.html` 2164–2299 行

**Interfaces:**
- Consumes: なし
- Produces:
  - `SPRITE: string` — `<svg>` 要素の HTML 文字列
  - `ICON_IDS: string[]` — 収録している symbol の id 一覧
  - `injectSprite(doc = document): void` — `<body>` の先頭にスプライトを挿す
  - `icon(id: string, extraClass = ""): string` — `<svg class="ico"><use href="#id"/></svg>` を返す
  - `CATEGORY_ICON: Record<string, string>` — カテゴリ → 既定アイコン id

- [ ] **Step 1: 失敗するテストを書く**

`tests/icons.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { SPRITE, ICON_IDS, icon, CATEGORY_ICON } from "../assets/js/icons.js";

const idsInSprite = () => [...SPRITE.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

test("Phase A で使うアイコンがすべて含まれている", () => {
  const required = [
    // カテゴリ既定
    "i-flight", "i-camera", "i-food", "i-hotel", "i-shop",
    // events.json が個別に指定するもの（現行データに実在する 9 種類のうち上記以外）
    "i-car", "i-boat", "i-pool", "i-luggage",
    // UI 部品
    "i-arrow-right", "i-calendar", "i-clock", "i-pin", "i-external",
    "i-chat", "i-search", "i-lock", "i-note",
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
  const body = SPRITE.replace(/<svg[^>]*>|<\/svg>/g, "");
  assert.doesNotMatch(body, /(?:fill|stroke)="(?!none")[^"]+"/);
});

test("icon() は use 参照を返す", () => {
  assert.equal(icon("i-pin"), '<svg class="ico"><use href="#i-pin"/></svg>');
  assert.equal(icon("i-pin", "ico--sm"), '<svg class="ico ico--sm"><use href="#i-pin"/></svg>');
});

test("icon() は未知の id を拒否する", () => {
  assert.throws(() => icon("i-nope"), /i-nope/);
});

test("すべてのカテゴリに既定アイコンがある", () => {
  for (const cat of ["cat-move", "cat-sight", "cat-food", "cat-hotel", "cat-shop"]) {
    assert.ok(CATEGORY_ICON[cat], `${cat} の既定アイコンがありません`);
    assert.ok(ICON_IDS.includes(CATEGORY_ICON[cat]));
  }
});

test("events.json が参照するアイコンがすべて存在する", () => {
  // 描画時に <use> が解決できず、アイコンが消えるのを防ぐ
  const data = JSON.parse(
    readFileSync(new URL("../assets/data/events.json", import.meta.url), "utf8")
  );
  // 空配列だとループが 0 回で素通りするので、件数そのものを先に確かめる
  assert.equal(data.events.length, 40, "events.json の件数が想定と違います");
  for (const ev of data.events) {
    const id = ev.icon ?? CATEGORY_ICON[ev.cat];
    assert.ok(id, `${ev.title}: カテゴリ ${ev.cat} に既定アイコンがありません`);
    assert.ok(ICON_IDS.includes(id), `${ev.title}: ${id} がスプライトにありません`);
  }
});
```

このテストは `assets/data/events.json` を読むので、ファイル先頭に import を足すこと:

```js
import { readFileSync } from "node:fs";
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test tests/icons.test.js`
Expected: FAIL。`Cannot find module .../assets/js/icons.js`。

- [ ] **Step 3: 実装する**

`assets/js/icons.js`。`<symbol>` の中身は `docs/design-reference/mock-aman.html` の 2164–2299 行から、下の一覧にある 17 個を写す。

```js
/**
 * インライン SVG スプライト。
 * アイコンフォントは使わない（追加リクエストと FOUT を避けるため）。
 * 線幅は 1.0〜1.4px で、1px のヘアライン罫線と太さを揃えている。
 * 色は .ico 側の stroke: currentColor で継承させるので、
 * symbol の中に fill / stroke を書かないこと。
 */

export const SPRITE = `
<svg class="sprite" aria-hidden="true" focusable="false">
  <symbol id="i-flight" viewBox="0 0 24 24">
    <path d="M21.5 2.5 2.6 10.1l7.3 2.9m11.6-10.5L14 21.4l-2.8-8.4m10.3-10.5-10.3 10.5"/>
  </symbol>
  <symbol id="i-camera" viewBox="0 0 24 24">
    <path d="M3 8.6h3.5L8 6h8l1.5 2.6H21v10.4H3z"/>
    <circle cx="12" cy="13.4" r="3.2"/>
  </symbol>
  <symbol id="i-food" viewBox="0 0 24 24">
    <path d="M7.4 3v5.6a2.2 2.2 0 0 0 4.4 0V3M9.6 8.6V21M16.6 3c-1.5 1.5-2.2 3.4-2.2 5.4 0 1.7.9 2.8 2.2 3.1V21"/>
  </symbol>
  <symbol id="i-hotel" viewBox="0 0 24 24">
    <path d="M3 6.5v12"/>
    <path d="M3 13.2h18V18.5"/>
    <path d="M6.4 10.4h4.2"/>
    <path d="M13.4 13.2v-2.8h5.1A2.5 2.5 0 0 1 21 12.9"/>
  </symbol>
  <symbol id="i-shop" viewBox="0 0 24 24">
    <path d="M5.2 8h13.6l1 12H4.2z"/>
    <path d="M9 8V6.2a3 3 0 0 1 6 0V8"/>
  </symbol>
  <symbol id="i-car" viewBox="0 0 24 24">
    <path d="M4.6 17.2v2.2h3v-2.2M16.4 17.2v2.2h3v-2.2"/>
    <path d="M3 17.2v-4.6L5.1 7h13.8l2.1 5.6v4.6z"/>
    <path d="M3 12.6h18"/>
    <path d="M6.9 14.9h.01M17.1 14.9h.01"/>
  </symbol>
  <symbol id="i-boat" viewBox="0 0 24 24">
    <path d="M2.8 18.2c1.6 0 1.6 1.6 3.2 1.6s1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6"/>
    <path d="M4.6 15.6 6.2 9.5h11.6l1.6 6.1z"/>
    <path d="M12 9.5V4.6H7.8"/>
  </symbol>
  <symbol id="i-arrow-right" viewBox="0 0 24 24">
    <path d="M3.5 12h17m-6.5-6.5L20.5 12 14 18.5"/>
  </symbol>
  <symbol id="i-calendar" viewBox="0 0 24 24">
    <path d="M3.8 5.8h16.4v14.4H3.8z"/>
    <path d="M3.8 10.2h16.4M8.4 3.4v4.4M15.6 3.4v4.4"/>
  </symbol>
  <symbol id="i-clock" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8.6"/>
    <path d="M12 6.6v5.7l3.6 2.1"/>
  </symbol>
  <symbol id="i-pin" viewBox="0 0 24 24">
    <path d="M12 21.2s6.6-6.4 6.6-10.8a6.6 6.6 0 1 0-13.2 0C5.4 14.8 12 21.2 12 21.2Z"/>
    <circle cx="12" cy="10.4" r="2.5"/>
  </symbol>
  <symbol id="i-external" viewBox="0 0 24 24">
    <path d="M13.6 3.8h6.6v6.6M20.2 3.8 10.6 13.4"/>
    <path d="M17.6 14v6.2H3.8V6.4H10"/>
  </symbol>
  <symbol id="i-chat" viewBox="0 0 24 24">
    <path d="M4 4.8h16v11.4H9.4L4 20.4z"/>
  </symbol>
  <symbol id="i-search" viewBox="0 0 24 24">
    <circle cx="10.8" cy="10.8" r="6.6"/>
    <path d="m15.7 15.7 4.6 4.6"/>
  </symbol>
  <symbol id="i-luggage" viewBox="0 0 24 24">
    <path d="M5.8 7.6h12.4v12.6H5.8z"/>
    <path d="M9.4 7.6V4.4h5.2v3.2M9.6 11.2v5.4M14.4 11.2v5.4"/>
  </symbol>
  <symbol id="i-lock" viewBox="0 0 24 24">
    <path d="M4.8 10.8h14.4v9.4H4.8z"/>
    <path d="M8.4 10.8V7.4a3.6 3.6 0 0 1 7.2 0v3.4"/>
  </symbol>
  <symbol id="i-note" viewBox="0 0 24 24">
    <path d="M4.6 3.8h14.8v16.4H4.6z"/>
    <path d="M8 8.4h8M8 12h8M8 15.6h4.6"/>
  </symbol>
  <symbol id="i-pool" viewBox="0 0 24 24">
    <path d="M2.6 15.4c1.6 0 1.6 1.5 3.2 1.5s1.6-1.5 3.2-1.5 1.6 1.5 3.2 1.5 1.6-1.5 3.2-1.5 1.6 1.5 3.2 1.5"/>
    <path d="M2.6 19.4c1.6 0 1.6 1.5 3.2 1.5s1.6-1.5 3.2-1.5 1.6 1.5 3.2 1.5 1.6-1.5 3.2-1.5 1.6 1.5 3.2 1.5"/>
    <path d="M7.6 15V4.8a2.2 2.2 0 0 1 4.4 0M16.4 14.2V4.8a2.2 2.2 0 0 0-4.4 0"/>
    <path d="M8 8.6h8"/>
  </symbol>
</svg>`.trim();

export const ICON_IDS = [
  "i-flight", "i-camera", "i-food", "i-hotel", "i-shop", "i-car", "i-boat",
  "i-arrow-right", "i-calendar", "i-clock", "i-pin", "i-external",
  "i-chat", "i-search", "i-luggage", "i-lock", "i-note", "i-pool",
];

export const CATEGORY_ICON = {
  "cat-move": "i-flight",
  "cat-sight": "i-camera",
  "cat-food": "i-food",
  "cat-hotel": "i-hotel",
  "cat-shop": "i-shop",
};

export function injectSprite(doc = document) {
  if (doc.querySelector("svg.sprite")) return;
  doc.body.insertAdjacentHTML("afterbegin", SPRITE);
}

export function icon(id, extraClass = "") {
  if (!ICON_IDS.includes(id)) {
    throw new Error(`icons: 未知のアイコン id です: ${id}`);
  }
  const cls = extraClass ? `ico ${extraClass}` : "ico";
  return `<svg class="${cls}"><use href="#${id}"/></svg>`;
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test tests/icons.test.js`
Expected: PASS。8 件すべて成功。

- [ ] **Step 5: コミット**

```bash
git add assets/js/icons.js tests/icons.test.js
git commit -m "$(cat <<'EOF'
Add inline SVG sprite

One sprite injected per page, referenced with <use>. No icon font, so
no extra request and no FOUT. Symbols carry no fill or stroke of their
own so .ico can drive them with currentColor.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: ページ間ナビと index.html（メニュー）

**Files:**
- Create: `assets/js/nav.js`
- Create: `assets/js/menu.js`
- Create: `packing.html`（スタブ）
- Create: `archive.html`（スタブ）
- Modify: `index.html`（全面差し替え）
- Reference: `docs/design-reference/mock-aman.html` 2564–2651 行（メニューの HTML）、807–876 行（メニューの CSS）

**Interfaces:**
- Consumes: `icons.js` の `injectSprite` / `icon`、`reveal.js` の `initReveal`
- Produces: `renderNav(mount: HTMLElement, current: string): void` — `current` は `"schedule" | "archive" | "packing"`

Phase A の時点では合言葉による認証は入れない（Phase C）。`index.html` はメニューだけを出す。

- [ ] **Step 1: `assets/js/nav.js` を作る**

```js
import { icon } from "./icons.js";

const PAGES = [
  { key: "schedule", href: "schedule.html", label: "旅程", ico: "i-calendar" },
  { key: "archive", href: "archive.html", label: "データ検索", ico: "i-search" },
  { key: "packing", href: "packing.html", label: "持ち物", ico: "i-luggage" },
];

export function renderNav(mount, current) {
  mount.innerHTML = `
    <a class="nav__home" href="index.html">Thailand 2026</a>
    <div class="nav__links">
      ${PAGES.map(
        (p) => `
        <a class="nav__link${p.key === current ? " is-current" : ""}"
           href="${p.href}"${p.key === current ? ' aria-current="page"' : ""}>
          ${icon(p.ico, "ico--sm")}<span>${p.label}</span>
        </a>`
      ).join("")}
    </div>`;
}
```

- [ ] **Step 2: ナビの CSS を `base.css` に足す**

```css
/* ページ間ナビ */
.nav {
  display: flex;
  align-items: center;
  gap: var(--s3);
  flex-wrap: wrap;
  padding: var(--s2) var(--gut);
  border-bottom: 1px solid var(--line-soft);
}
.nav__home {
  font-family: var(--serif);
  font-size: 17px;
  font-weight: 300;
  letter-spacing: 0.5px;
}
.nav__links {
  display: flex;
  gap: var(--s2);
  margin-left: auto;
  flex-wrap: wrap;
}
.nav__link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  font-size: 11px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--ink-2);
  transition: color var(--t-fast) var(--e-out),
    border-color var(--t-fast) var(--e-out);
}
.nav__link:hover {
  color: var(--ink);
  border-color: var(--line-soft);
}
.nav__link.is-current {
  color: var(--ink);
  border-color: var(--ink);
}
```

- [ ] **Step 3: `index.html` を書き直す**

```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Thailand 2026</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,200;6..72,300;6..72,400&family=Inter:wght@300;400;500&family=Noto+Sans+JP:wght@300;400;500&family=Noto+Serif+JP:wght@200;300;400&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="assets/css/tokens.css" />
    <link rel="stylesheet" href="assets/css/base.css" />
    <link rel="stylesheet" href="assets/css/controls.css" />
  </head>
  <body>
    <nav class="nav" id="nav"></nav>

    <main class="wrap sec">
      <div class="menu__head reveal">
        <div>
          <p class="eyebrow">12–17 August 2026</p>
          <h1 class="display lines" style="margin-top: var(--s2)">
            <span class="ln"><i>Thailand</i></span>
          </h1>
        </div>
        <p class="micro" id="countdown"></p>
      </div>

      <div class="menu__grid" id="menu"></div>
    </main>

    <script type="module" src="assets/js/menu.js"></script>
  </body>
</html>
```

- [ ] **Step 4: `assets/js/menu.js` を作る**

```js
import { injectSprite, icon } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";

const DEPARTURE = new Date("2026-08-12T00:00:00+09:00");

const CARDS = [
  {
    href: "schedule.html",
    num: "01",
    eyebrow: "Itinerary",
    title: "旅程",
    ico: "i-calendar",
    desc: "6日間のタイムライン、地図、各スポットの詳細とメモ。",
    image:
      "https://www.thailandtravel.or.jp/wp-content/uploads/2017/07/241531199_1074098326727081_2405869266411881148_nSNSre.jpg",
  },
  {
    href: "archive.html",
    num: "02",
    eyebrow: "Archive",
    title: "データ検索",
    ico: "i-search",
    desc: "Gmail と LINE から集めた予約・やりとりを横断検索。",
    image:
      "https://enjoy-bkk.com/wp-content/uploads/2016/10/EmQuartier-1200-628.jpg",
  },
  {
    href: "packing.html",
    num: "03",
    eyebrow: "Packing",
    title: "持ち物リスト",
    ico: "i-luggage",
    desc: "二人分のチェックリスト。アイテムごとにメモを残せます。",
    image:
      "https://www.thailandtravel.or.jp/wp-content/uploads/2017/03/01871-808x538.jpg",
  },
];

injectSprite();
renderNav(document.getElementById("nav"), null);

document.getElementById("menu").innerHTML = CARDS.map(
  (c, i) => `
  <a class="card reveal" href="${c.href}" style="--d:${(i * 0.12).toFixed(2)}s">
    <div class="card__img">
      <span class="card__num">${c.num}</span>
      <img src="${c.image}" alt="" loading="lazy">
    </div>
    <div class="card__body">
      <p class="eyebrow">${c.eyebrow}</p>
      <h2 class="h3">${icon(c.ico)} ${c.title}</h2>
      <p class="micro">${c.desc}</p>
      <span class="swipe card__arrow">開く ${icon("i-arrow-right", "ico--sm")}</span>
    </div>
  </a>`
).join("");

const daysLeft = Math.ceil((DEPARTURE - Date.now()) / 86_400_000);
document.getElementById("countdown").innerHTML =
  daysLeft > 0
    ? `出発まで あと ${daysLeft} 日<br>依田家・篠崎家 合同`
    : "依田家・篠崎家 合同";

initReveal();
```

- [ ] **Step 5: メニューの CSS を `base.css` に足す**

`docs/design-reference/mock-aman.html` の 807–876 行（`.menu__head` `.menu__grid` `.card` `.card__img` `.card__num` `.card__body` `.card__arrow`）をそのまま写す。

- [ ] **Step 6: スタブページを 2 つ作る**

`packing.html` と `archive.html`。`index.html` と同じ `<head>` を持ち、本文は次のとおり。`packing.html` は「持ち物リスト」「Phase B で作ります。」、`archive.html` は「データ検索」「Phase C で作ります。」に読み替える。

```html
  <body>
    <nav class="nav" id="nav"></nav>
    <main class="wrap sec">
      <p class="eyebrow">Packing</p>
      <h1 class="display" style="font-size: clamp(32px, 4.2vw, 50px)">持ち物リスト</h1>
      <p class="body" style="margin-top: var(--s3)">このページはまだ作成中です。</p>
      <a class="btn" href="index.html" style="margin-top: var(--s4)">メニューへ戻る</a>
    </main>
    <script type="module">
      import { injectSprite } from "./assets/js/icons.js";
      import { renderNav } from "./assets/js/nav.js";
      injectSprite();
      renderNav(document.getElementById("nav"), "packing");
    </script>
  </body>
```

- [ ] **Step 7: ブラウザで確認する**

Run: `python3 -m http.server 8000` を起動し、`http://localhost:8000/` を開く。

DevTools のコンソールに貼って確認する:

```js
({
  consoleErrors: "コンソールにエラーが出ていないことを目視で確認",
  cards: document.querySelectorAll(".card").length,          // 3
  navLinks: document.querySelectorAll(".nav__link").length,  // 3
  icons: document.querySelectorAll("svg.ico").length,        // 7 以上
  brokenUse: [...document.querySelectorAll("use")]
    .filter(u => !document.getElementById(u.getAttribute("href").slice(1))).length, // 0
  unrevealed: document.querySelectorAll(".reveal:not(.is-in)").length,              // 0
  hOverflow: document.documentElement.scrollWidth > innerWidth,                     // false
})
```

さらに、ナビの各リンクをクリックして `schedule.html`（まだ存在しないので 404 でよい）以外の 2 ページが開き、「メニューへ戻る」で戻れることを確認する。

- [ ] **Step 8: コミット**

```bash
git add index.html packing.html archive.html assets/js/nav.js assets/js/menu.js assets/css/base.css
git commit -m "$(cat <<'EOF'
Replace index.html with a menu and add page stubs

The old single-file itinerary moves to schedule.html in the next task.
Passphrase gating arrives in Phase C; for now the menu is open.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: schedule.html — カレンダー描画

**Files:**
- Create: `assets/css/calendar.css`
- Create: `assets/js/calendar.js`
- Create: `assets/js/schedule.js`
- Create: `schedule.html`
- Reference: `docs/design-reference/mock-aman.html` 877–1223 行（カレンダー CSS）、2652–2696 行（HTML）

**Interfaces:**
- Consumes: `expandEvents`（Task 3）、`assignLanes`（Task 4）、`timeLabel`（Task 1）、`icon` / `CATEGORY_ICON`（Task 7）
- Produces:
  - `HOUR_H: number` = 44
  - `renderCalendar(opts): void` — `opts` は
    `{ mount: HTMLElement, days: Day[], events: Event[], viewStart: number, viewEnd: number, catFilter: string|null, onSelect: (ev: Event) => void }`
  - `CAT_META: Record<string, {label: string}>`

- [ ] **Step 1: `assets/css/calendar.css` を作る**

`docs/design-reference/mock-aman.html` の 877–1223 行を写す。ただし次を守ること。

1. `44px` / `43px` のハードコードを `var(--hour-h)` / `calc(var(--hour-h) - 1px)` に置き換える。`.cal__col` の `repeating-linear-gradient` も同様
2. `.toolbar` `.cal` `.cal__row` `.cal__days` `.cal__dayhdr` `.cal__dow` `.cal__date` `.cal__allday-*` `.cal__slot` `.cal__col` `.ev*` `.cat-*` `.mapsec` `#leaflet-map` `.loclist` `.loc*` `.pin` を含める
3. 2072 行以降の RESPONSIVE ブロックのうち、カレンダーと地図に関する指定（横スクロール、時間列の `position: sticky`）も写す

- [ ] **Step 2: `assets/js/calendar.js` を作る**

```js
import { timeLabel } from "./time.js";
import { expandEvents } from "./events.js";
import { assignLanes } from "./lanes.js";
import { icon, CATEGORY_ICON } from "./icons.js";

/** 1時間あたりのピクセル高さ。tokens.css の --hour-h と一致させること。 */
export const HOUR_H = 44;

export const CAT_META = {
  "cat-move": { label: "移動" },
  "cat-sight": { label: "観光" },
  "cat-food": { label: "食事" },
  "cat-hotel": { label: "宿泊" },
  "cat-shop": { label: "買物" },
};

const iconOf = (ev) => ev.icon || CATEGORY_ICON[ev.cat];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function renderCalendar({ mount, days, events, viewStart, viewEnd, catFilter, onSelect }) {
  mount.innerHTML = "";
  const segments = expandEvents(events, days.length);

  mount.appendChild(buildHeader(days));
  mount.appendChild(buildAllDayRow(days, segments, onSelect));
  mount.appendChild(buildBody(days, segments, { viewStart, viewEnd, catFilter, onSelect }));
}

function buildHeader(days) {
  const row = el("div", "cal__row");
  row.appendChild(el("div", "cal__hdr-gutter"));
  const cells = el("div", "cal__days");
  for (const d of days) {
    const cell = el("div", "cal__dayhdr");
    const modifier =
      d.dow === "土" ? " cal__dow--sat" : d.dow === "日" ? " cal__dow--sun" : "";
    cell.appendChild(el("div", `cal__dow${modifier}`, d.dow));
    cell.appendChild(el("div", "cal__date", d.date));
    cells.appendChild(cell);
  }
  row.appendChild(cells);
  return row;
}

function buildAllDayRow(days, segments, onSelect) {
  const row = el("div", "cal__row");
  row.appendChild(el("div", "cal__allday-label", "All day"));
  const cells = el("div", "cal__days");

  days.forEach((_, dayIndex) => {
    const cell = el("div", "cal__allday-cell");
    for (const seg of segments.filter((s) => s.allDay && s.day === dayIndex)) {
      const ev = seg.ref;
      const pill = el("div", `allday-pill ${ev.cat}`);
      pill.innerHTML = `${icon(iconOf(ev), "ico--sm")}<span>${ev.title}</span>`;
      pill.addEventListener("click", () => onSelect(ev));
      cell.appendChild(pill);
    }
    cells.appendChild(cell);
  });

  row.appendChild(cells);
  return row;
}

function buildBody(days, segments, { viewStart, viewEnd, catFilter, onSelect }) {
  const row = el("div", "cal__row");

  const gutter = el("div", "cal__gutter");
  for (let h = viewStart; h < viewEnd; h++) {
    gutter.appendChild(el("div", "cal__slot", `${String(h).padStart(2, "0")}:00`));
  }
  row.appendChild(gutter);

  const columns = el("div", "cal__days");
  const totalHeight = (viewEnd - viewStart) * HOUR_H;
  let order = 0;

  days.forEach((_, dayIndex) => {
    const column = el("div", "cal__col");
    column.style.height = `${totalHeight}px`;

    const visible = segments.filter(
      (s) =>
        !s.allDay &&
        s.day === dayIndex &&
        s.end > viewStart &&
        s.start < viewEnd &&
        (!catFilter || s.ref.cat === catFilter)
    );

    for (const seg of assignLanes(visible)) {
      column.appendChild(buildBlock(seg, { viewStart, viewEnd, order: order++, onSelect }));
    }
    columns.appendChild(column);
  });

  row.appendChild(columns);
  return row;
}

function buildBlock(seg, { viewStart, viewEnd, order, onSelect }) {
  const ev = seg.ref;
  const from = Math.max(seg.start, viewStart);
  const to = Math.min(seg.end, viewEnd);
  const top = (from - viewStart) * HOUR_H;
  const height = Math.max((to - from) * HOUR_H - 2, 22);
  const width = 100 / seg.laneCount;

  const block = el("div", `ev ${ev.cat}`);
  block.style.cssText = [
    `top:${top}px`,
    `height:${height}px`,
    `left:${seg.lane * width}%`,
    `width:calc(${width}% - 2px)`,
    `--d:${(order * 0.012).toFixed(3)}s`,
  ].join(";");

  const label = timeLabel(ev);
  const head = el("div", "ev__hd");
  // 高さが足りないと時刻が読めないので、そのときは省いてタイトルを優先する
  head.innerHTML =
    icon(iconOf(ev)) + (height >= 36 ? `<span class="ev__t">${label}</span>` : "");
  block.appendChild(head);
  block.appendChild(el("div", "ev__n", ev.title));
  block.title = `${ev.title} / ${label}`;
  block.addEventListener("click", () => onSelect(ev));
  return block;
}
```

- [ ] **Step 3: `schedule.html` を作る**

`<head>` は `index.html` と同じものに `calendar.css` を足す。Leaflet は Task 10 で足すのでまだ書かない。

```html
  <body>
    <nav class="nav" id="nav"></nav>

    <main class="wrap sec">
      <div class="shead reveal">
        <div class="shead__idx"><span class="n">01</span>Itinerary</div>
        <div>
          <h1 class="display lines" style="font-size: clamp(38px, 5vw, 72px)">
            <span class="ln"><i>六日間の道のり</i></span>
          </h1>
        </div>
      </div>

      <div class="toolbar reveal">
        <div class="toolbar__group">
          <span class="eyebrow">Hours</span>
          <select id="view-start" aria-label="表示開始時刻"></select>
          <span class="micro">—</span>
          <select id="view-end" aria-label="表示終了時刻"></select>
        </div>
        <div class="toolbar__group" id="cat-filters">
          <span class="eyebrow">Category</span>
        </div>
      </div>

      <div class="cal" id="cal"></div>
    </main>

    <script type="module" src="assets/js/schedule.js"></script>
  </body>
```

- [ ] **Step 4: `assets/js/schedule.js` を作る**

```js
import { injectSprite } from "./icons.js";
import { initReveal } from "./reveal.js";
import { renderNav } from "./nav.js";
import { renderCalendar, CAT_META } from "./calendar.js";

const state = {
  days: [],
  events: [],
  viewStart: 6,
  viewEnd: 22,
  catFilter: null,
};

const els = {
  cal: document.getElementById("cal"),
  viewStart: document.getElementById("view-start"),
  viewEnd: document.getElementById("view-end"),
  catFilters: document.getElementById("cat-filters"),
};

function draw() {
  renderCalendar({
    mount: els.cal,
    days: state.days,
    events: state.events,
    viewStart: state.viewStart,
    viewEnd: state.viewEnd,
    catFilter: state.catFilter,
    onSelect: (ev) => console.log("選択:", ev.title),
  });
}

function fillHourOptions(select, min, max, selected) {
  select.innerHTML = "";
  for (let h = min; h <= max; h++) {
    const option = document.createElement("option");
    option.value = String(h);
    option.textContent = `${String(h).padStart(2, "0")}:00`;
    if (h === selected) option.selected = true;
    select.appendChild(option);
  }
}

function buildCategoryFilters() {
  const buttons = [];
  const makeChip = (label, value) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(state.catFilter === value));
    button.addEventListener("click", () => {
      state.catFilter = state.catFilter === value ? null : value;
      for (const b of buttons) {
        b.setAttribute("aria-pressed", String(b.dataset.value === (state.catFilter ?? "")));
      }
      draw();
    });
    button.dataset.value = value ?? "";
    buttons.push(button);
    return button;
  };

  els.catFilters.appendChild(makeChip("すべて", null));
  for (const [key, meta] of Object.entries(CAT_META)) {
    els.catFilters.appendChild(makeChip(meta.label, key));
  }
}

async function main() {
  injectSprite();
  renderNav(document.getElementById("nav"), "schedule");

  const response = await fetch("assets/data/events.json");
  if (!response.ok) {
    els.cal.innerHTML =
      '<p class="ferror">旅程データを読み込めませんでした。ローカルサーバー経由で開いているか確認してください。</p>';
    return;
  }
  const data = await response.json();
  state.days = data.days;
  state.events = data.events;

  fillHourOptions(els.viewStart, 0, 12, state.viewStart);
  fillHourOptions(els.viewEnd, 13, 24, state.viewEnd);

  els.viewStart.addEventListener("change", (e) => {
    state.viewStart = Number(e.target.value);
    draw();
  });
  els.viewEnd.addEventListener("change", (e) => {
    state.viewEnd = Number(e.target.value);
    draw();
  });

  buildCategoryFilters();
  draw();
  initReveal();
}

main();
```

- [ ] **Step 5: ブラウザで確認する**

`http://localhost:8000/schedule.html` を開き、コンソールに貼る:

```js
(() => {
  const cols = [...document.querySelectorAll(".cal__col")];
  let overflow = 0;
  for (const c of cols) {
    const cb = c.getBoundingClientRect();
    for (const e of c.querySelectorAll(".ev")) {
      const eb = e.getBoundingClientRect();
      if (eb.right > cb.right + 1 || eb.bottom > cb.bottom + 1 || eb.left < cb.left - 1) overflow++;
    }
  }
  const named = (t) => [...document.querySelectorAll(".ev__n")]
    .filter(n => n.textContent === t).length;
  return {
    columns: cols.length,                                      // 6
    columnHeight: cols[0].getBoundingClientRect().height,      // 704 (= 16h * 44)
    allday: document.querySelectorAll(".allday-pill").length,  // 5
    bangkokHotelSegments: named("バンコクホテル"),               // 3 (8/12→8/14)
    pattayaHotelSegments: named("パタヤホテル"),                 // 3 (8/14→8/16)
    eventOverflow: overflow,                                   // 0
    brokenUse: [...document.querySelectorAll("use")]
      .filter(u => !document.getElementById(u.getAttribute("href").slice(1))).length, // 0
    hOverflow: document.documentElement.scrollWidth > innerWidth, // false
  };
})()
```

`.ev` の総数は表示時間帯（既定 6:00–22:00）で変わるので、固定値では確認しない。
代わりに、日をまたぐ 2 件が正しくセグメントに割れていることと、はみ出しが 0 件で
あることを見る。

そのうえで手で確認する:
- カテゴリのチップを押すとカレンダーが絞り込まれ、「すべて」で戻る
- 表示時間帯を 0:00–24:00 に変えると、深夜の帰国フライトが見える
- イベントをクリックするとコンソールに `選択: <タイトル>` が出る

- [ ] **Step 6: コミット**

```bash
git add schedule.html assets/css/calendar.css assets/js/calendar.js assets/js/schedule.js
git commit -m "$(cat <<'EOF'
Add the itinerary calendar page

renderCalendar takes state as arguments and holds none of its own, so
schedule.js stays the single owner of view range and filter.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Leaflet のセルフホストと地図・ロケーション一覧

**Files:**
- Create: `assets/vendor/leaflet/leaflet.js`, `leaflet.css`, `images/*`
- Create: `assets/js/map.js`
- Modify: `schedule.html`（Leaflet の読み込みと地図の器を足す）
- Modify: `assets/js/schedule.js`（地図の結線）

**Interfaces:**
- Consumes: `collectLocations` / `hasCoords`（Task 3）、`timeLabel`（Task 1）、`icon` / `CATEGORY_ICON`（Task 7）
- Produces: `createMap({ mapMount, listMount, days, onSelect }): { update(events, catFilter): void }`

**Leaflet を CDN から読み込まない。** Phase B で書き込み権限を持つ GitHub トークンをブラウザに保存するため、外部 CDN の JS が改竄された場合にトークンの流出とリポジトリへの任意の push を許してしまう。自前で配置する。

- [ ] **Step 1: Leaflet を取得して配置する**

`curl` には `-f` を付けて、404 のときに終了コードで落とす。付けないとエラーページの HTML が
`leaflet.js` として保存され、ブラウザで初めて気づくことになる。

```bash
set -e
BASE=https://unpkg.com/leaflet@1.9.4/dist
mkdir -p assets/vendor/leaflet/images

curl -fsSL -o assets/vendor/leaflet/leaflet.js  "$BASE/leaflet.js"
curl -fsSL -o assets/vendor/leaflet/leaflet.css "$BASE/leaflet.css"

for f in marker-icon.png marker-icon-2x.png marker-shadow.png layers.png layers-2x.png; do
  curl -fsSL -o "assets/vendor/leaflet/images/$f" "$BASE/images/$f"
done

ls -l assets/vendor/leaflet assets/vendor/leaflet/images
```

Expected: `leaflet.js`（約 147KB）、`leaflet.css`（約 15KB）、`images/` に 5 ファイル。
いずれかの `curl` が落ちたらそこで止まる（`set -e`）。

- [ ] **Step 2: 取得したファイルを検証する**

```bash
head -c 200 assets/vendor/leaflet/leaflet.js
grep -c "leaflet" assets/vendor/leaflet/leaflet.css
```

Expected: 先頭に Leaflet 1.9.4 のバナーコメントがあること。HTML（エラーページ）が保存されていないこと。

- [ ] **Step 3: `assets/js/map.js` を作る**

```js
import { collectLocations } from "./events.js";
import { timeLabel } from "./time.js";
import { icon, CATEGORY_ICON } from "./icons.js";
import { CAT_META } from "./calendar.js";

/**
 * タイルは CartoDB Positron（低彩度）を使う。
 * Voyager は彩度が高く、無彩色基調のページから浮くため。
 */
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

const iconOf = (ev) => ev.icon || CATEGORY_ICON[ev.cat];
const keyOf = (ev) => `${ev.lat},${ev.lng}`;

/** カテゴリのアクセント色を tokens.css から読む。色をここに書かない。 */
function accentColor(cat) {
  const name = `--c-${cat.replace("cat-", "")}`;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function createMap({ mapMount, listMount, days, onSelect }) {
  const map = L.map(mapMount, { scrollWheelZoom: false }).setView([13.4, 100.7], 8);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(map);

  let markers = new Map();

  function drawMarkers(locations) {
    for (const marker of markers.values()) map.removeLayer(marker);
    markers = new Map();

    for (const ev of locations) {
      const divIcon = L.divIcon({
        className: "",
        html: `<div class="pin" style="background:${accentColor(ev.cat)}">
                 <svg viewBox="0 0 24 24"><use href="#${iconOf(ev)}"/></svg>
               </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const marker = L.marker([ev.lat, ev.lng], { icon: divIcon })
        .addTo(map)
        .bindPopup(
          `<div class="pop__title">${ev.title}</div>` +
            `<div class="pop__meta">${ev.location || ""}</div>`
        );
      markers.set(keyOf(ev), marker);
    }

    if (locations.length) {
      map.fitBounds(L.latLngBounds(locations.map((e) => [e.lat, e.lng])).pad(0.18));
    }
  }

  function drawList(locations) {
    listMount.innerHTML = "";
    for (const ev of locations) {
      const day = days[ev.startDay];
      const row = document.createElement("div");
      row.className = "loc";
      row.innerHTML = `
        <div class="loc__thumbwrap">
          <img class="loc__thumb" src="${ev.image || ""}" alt="" loading="lazy">
        </div>
        <div>
          <div class="loc__cat" style="color:${accentColor(ev.cat)}">
            ${icon(iconOf(ev), "ico--sm")}${CAT_META[ev.cat].label}
          </div>
          <div class="loc__name">${ev.title}</div>
          <div class="loc__meta">${day.date}（${day.dow}） · ${timeLabel(ev)}</div>
        </div>
        <span class="loc__go">${icon("i-arrow-right", "ico--sm")}</span>`;

      row.addEventListener("click", () => {
        map.flyTo([ev.lat, ev.lng], 14, { duration: 0.8 });
        markers.get(keyOf(ev))?.openPopup();
        onSelect?.(ev);
      });
      listMount.appendChild(row);
    }
  }

  return {
    update(events, catFilter) {
      const locations = collectLocations(events, catFilter);
      drawMarkers(locations);
      drawList(locations);
    },
  };
}
```

- [ ] **Step 4: `schedule.html` に地図を足す**

`<head>` の `calendar.css` の前に:

```html
    <link rel="stylesheet" href="assets/vendor/leaflet/leaflet.css" />
```

`</main>` の直前、`<div class="cal" id="cal"></div>` の後に:

```html
      <div class="mapsec reveal">
        <div id="leaflet-map"></div>
        <div class="loclist" id="loclist"></div>
      </div>
```

`</body>` の直前、`schedule.js` の**前**に（`L` をグローバルに用意するため）:

```html
    <script src="assets/vendor/leaflet/leaflet.js"></script>
```

- [ ] **Step 5: `assets/js/schedule.js` を書き足す**

import に追加:

```js
import { createMap } from "./map.js";
```

`const state` の下に:

```js
let mapView = null;
```

`draw()` を差し替える:

```js
function draw() {
  renderCalendar({
    mount: els.cal,
    days: state.days,
    events: state.events,
    viewStart: state.viewStart,
    viewEnd: state.viewEnd,
    catFilter: state.catFilter,
    onSelect: (ev) => console.log("選択:", ev.title),
  });
  mapView?.update(state.events, state.catFilter);
}
```

`main()` 内、`buildCategoryFilters();` の直前に:

```js
  mapView = createMap({
    mapMount: document.getElementById("leaflet-map"),
    listMount: document.getElementById("loclist"),
    days: state.days,
    onSelect: (ev) => console.log("選択:", ev.title),
  });
```

- [ ] **Step 6: ポップアップの CSS を `calendar.css` に足す**

```css
/* Leaflet のポップアップをデザインに合わせる */
.leaflet-popup-content-wrapper {
  border-radius: var(--r-sm);
  background: var(--sand-lt);
  color: var(--ink);
}
.leaflet-popup-tip {
  background: var(--sand-lt);
}
.pop__title {
  font-family: var(--serif);
  font-size: 16px;
  font-weight: 300;
  letter-spacing: 0.3px;
}
.pop__meta {
  font-size: 11px;
  letter-spacing: 0.3px;
  color: var(--ink-2);
  margin-top: 5px;
}
```

- [ ] **Step 7: ブラウザで確認する**

`http://localhost:8000/schedule.html` を開き、コンソールに貼る:

```js
({
  tiles: document.querySelectorAll("#leaflet-map .leaflet-tile").length,   // 8 以上
  pins: document.querySelectorAll(".pin").length,                          // 17
  locRows: document.querySelectorAll(".loc").length,                       // 17
  pinHasColor: getComputedStyle(document.querySelector(".pin")).backgroundColor, // rgb(...) で空でない
  cdnRequests: performance.getEntriesByType("resource")
    .map(r => r.name).filter(n => /unpkg|jsdelivr|cdnjs/.test(n)),         // []
  brokenUse: [...document.querySelectorAll("use")]
    .filter(u => !document.getElementById(u.getAttribute("href").slice(1))).length, // 0
})
```

**`cdnRequests` が空配列であること**を必ず確認する。Leaflet が CDN から読まれていたらセルフホストできていない。

手で確認する:
- 一覧の行をクリックすると地図が飛び、ポップアップが開く
- カテゴリで絞ると地図のピンと一覧が同時に減る

- [ ] **Step 8: コミット**

```bash
git add assets/vendor/leaflet assets/js/map.js assets/js/schedule.js assets/css/calendar.css schedule.html
git commit -m "$(cat <<'EOF'
Add the map and location list, with Leaflet self-hosted

Leaflet is vendored rather than loaded from unpkg. Phase B stores a
repo-write GitHub token in the browser, and a compromised CDN script
could read it and push arbitrary content.

Pin colours are read from the CSS custom properties so the palette
still lives in one place.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: 詳細シート（読み取り専用）

**Files:**
- Create: `assets/js/sheet.js`
- Modify: `schedule.html`（シートの器を足す）
- Modify: `assets/js/schedule.js`（結線）
- Reference: `docs/design-reference/mock-aman.html` 3022–3043 行（HTML）、1224–1406 行（CSS、Task 6 で導入済み）

**Interfaces:**
- Consumes: `timeLabel`（Task 1）、`icon` / `CATEGORY_ICON`（Task 7）、`CAT_META`（Task 9）
- Produces:
  - `createSheet({ root, overlay, titleEl, bodyEl, footEl }): { open(renderFn, title), close() }`
  - `renderEventDetail(ev, days): string` — シート本文の HTML を返す

Phase B で編集フォームを同じシートに載せるため、開閉とフォーカス管理は `sheet.js` に、中身の生成は呼び出し側に分ける。

- [ ] **Step 1: `assets/js/sheet.js` を作る**

```js
import { timeLabel } from "./time.js";
import { icon, CATEGORY_ICON } from "./icons.js";
import { CAT_META } from "./calendar.js";

export function createSheet({ root, overlay, titleEl, bodyEl, footEl, closeBtn }) {
  let lastFocused = null;

  function open(title, bodyHtml, footNodes = []) {
    lastFocused = document.activeElement;
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    footEl.innerHTML = "";
    for (const node of footNodes) footEl.appendChild(node);

    root.classList.add("is-open");
    overlay.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    bodyEl.scrollTop = 0;
    (footEl.querySelector("button") ?? closeBtn).focus();
  }

  function close() {
    root.classList.remove("is-open");
    overlay.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    lastFocused?.focus();
  }

  const isOpen = () => root.classList.contains("is-open");

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  return { open, close, isOpen };
}

const iconOf = (ev) => ev.icon || CATEGORY_ICON[ev.cat];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const metaRow = (iconId, label, value) =>
  `<div class="panel__mrow">${icon(iconId)}<dt>${label}</dt><dd>${value}</dd></div>`;

function dayRangeLabel(ev, days) {
  const from = days[ev.startDay];
  const to = days[Math.max(ev.endDay, ev.startDay)];
  return ev.endDay > ev.startDay
    ? `${from.date}（${from.dow}） → ${to.date}（${to.dow}）`
    : `${from.date}（${from.dow}）`;
}

export function renderEventDetail(ev, days) {
  const image = ev.image
    ? `<img class="sheet__img" src="${escapeHtml(ev.image)}" alt=""
         style="object-position:${escapeHtml(ev.imagePos || "center")}">`
    : "";

  const link = ev.url
    ? metaRow(
        "i-external",
        "Link",
        `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener">
           開く ${icon("i-external", "ico--sm")}</a>`
      )
    : "";

  const coords =
    ev.lat != null && ev.lng != null ? metaRow("i-pin", "Coords", `${ev.lat}, ${ev.lng}`) : "";

  const notes = ev.notes
    ? `<p class="body" style="margin-top:var(--s3);white-space:pre-wrap">${escapeHtml(ev.notes)}</p>`
    : "";

  return `
    ${image}
    <span class="panel__cat ${ev.cat}">
      ${icon(iconOf(ev), "ico--sm")} ${CAT_META[ev.cat].label}
    </span>
    <h3 class="panel__title">${escapeHtml(ev.title) || "（無題）"}</h3>
    <dl class="panel__meta">
      ${metaRow("i-calendar", "Date", dayRangeLabel(ev, days))}
      ${metaRow("i-clock", "Time", timeLabel(ev))}
      ${ev.location ? metaRow("i-pin", "Location", escapeHtml(ev.location)) : ""}
      ${coords}
      ${link}
    </dl>
    ${notes}`;
}
```

- [ ] **Step 2: `schedule.html` にシートの器を足す**

`</main>` の後、`<script>` の前に:

```html
    <div class="sheet-overlay" id="sheet-overlay"></div>
    <aside class="sheet" id="sheet" role="dialog" aria-modal="true"
           aria-labelledby="sheet-title" aria-hidden="true">
      <div class="sheet__head">
        <p class="eyebrow" id="sheet-title">予定</p>
        <button class="rowbtn" id="sheet-close" aria-label="閉じる">
          <svg class="ico ico--sm"><use href="#i-arrow-right"/></svg>
        </button>
      </div>
      <div class="sheet__body" id="sheet-body"></div>
      <div class="sheet__foot" id="sheet-foot"></div>
    </aside>
```

- [ ] **Step 3: `assets/js/schedule.js` を結線する**

import に追加:

```js
import { createSheet, renderEventDetail } from "./sheet.js";
```

`main()` の `injectSprite();` の直後に:

```js
  const sheet = createSheet({
    root: document.getElementById("sheet"),
    overlay: document.getElementById("sheet-overlay"),
    titleEl: document.getElementById("sheet-title"),
    bodyEl: document.getElementById("sheet-body"),
    footEl: document.getElementById("sheet-foot"),
    closeBtn: document.getElementById("sheet-close"),
  });

  // Phase B でここに編集ボタンが増える
  const openDetail = (ev) =>
    sheet.open("予定の詳細", renderEventDetail(ev, state.days));
```

`draw()` と `createMap()` の `onSelect` を `console.log` から `openDetail` に差し替える。`openDetail` は `main()` のスコープにあるので、`draw()` をモジュール直下ではなく `main()` の中に移すか、`state` にぶら下げること。**`state.onSelect = openDetail;` を `main()` で設定し、`draw()` は `state.onSelect` を渡す形にするのが簡単。**

- [ ] **Step 4: ブラウザで確認する**

`http://localhost:8000/schedule.html` を開き、コンソールに貼る:

```js
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const sheet = document.getElementById("sheet");
  document.querySelector(".ev").click();
  await wait(600);
  const opened = {
    isOpen: sheet.classList.contains("is-open"),
    ariaHidden: sheet.getAttribute("aria-hidden"),   // "false"
    bodyLocked: document.body.style.overflow,        // "hidden"
    metaRows: sheet.querySelectorAll(".panel__mrow").length, // 2 以上
    title: document.getElementById("sheet-title").textContent, // "予定の詳細"
  };
  dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await wait(600);
  return { opened, closedByEsc: !sheet.classList.contains("is-open"),
           bodyRestored: document.body.style.overflow === "" };
})()
```

手で確認する:
- 終日のピル（ホテル）をクリックしてもシートが開き、Date が「8/12（水） → 8/14（金）」のように範囲で出る
- 背景クリックでも閉じる
- 閉じたあとフォーカスが元のイベントに戻る
- 390px 幅でシートが画面いっぱいに出て、横スクロールが出ない

- [ ] **Step 5: コミット**

```bash
git add assets/js/sheet.js assets/js/schedule.js schedule.html
git commit -m "$(cat <<'EOF'
Add the read-only event detail sheet

Open/close and focus handling live in sheet.js while the body markup
is supplied by the caller, so Phase B can mount the edit form in the
same shell.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: レスポンシブ検証、旧ファイル撤去、ドキュメント更新

**Files:**
- Modify: `assets/css/calendar.css`（レスポンシブの確認と修正）
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Delete: 旧 `index.html` の残骸（Task 8 で差し替え済みなら不要）

- [ ] **Step 1: 390px で横溢れを確認する**

DevTools を 390 × 844 にして各ページを開き、コンソールに貼る:

```js
(() => {
  const inScroller = (n) => {
    let p = n.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
      p = p.parentElement;
    }
    return false;
  };
  const offenders = [...document.querySelectorAll("body *")]
    .filter(n => n.getBoundingClientRect().right > innerWidth + 1 && !inScroller(n))
    .slice(0, 8)
    .map(n => n.tagName + "." + (typeof n.className === "string" ? n.className.split(" ")[0] : ""));
  return {
    scrollWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
    hOverflow: document.documentElement.scrollWidth > innerWidth,  // false
    offenders,                                                     // []
    calScrolls: document.getElementById("cal")
      ? document.getElementById("cal").scrollWidth > document.getElementById("cal").clientWidth
      : null,                                                      // schedule.html では true
    gutterSticky: document.querySelector(".cal__gutter")
      ? getComputedStyle(document.querySelector(".cal__gutter")).position
      : null,                                                      // "sticky"
  };
})()
```

`index.html` / `schedule.html` / `packing.html` / `archive.html` の 4 ページすべてで `hOverflow: false` になること。ならなければ `offenders` に出た要素を直す。

**カレンダーは横スクロールが正しい挙動。** 6 列を 390px に押し込むと潰れるため、`.cal` を `overflow-x: auto` にし、時間列を `position: sticky; left: 0` で残す。

- [ ] **Step 2: 1440px で回帰を確認する**

DevTools を 1440 × 900 に戻し、`schedule.html` で:

```js
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  scrollTo(0, document.documentElement.scrollHeight);
  await wait(2000);
  scrollTo(0, 0);
  return {
    unrevealed: document.querySelectorAll(".reveal:not(.is-in)").length,  // 0
    hOverflow: document.documentElement.scrollWidth > innerWidth,          // false
    pins: document.querySelectorAll(".pin").length,                        // 17
    locRows: document.querySelectorAll(".loc").length,                     // 17
  };
})()
```

**最下部まで一気にジャンプしたあとで `unrevealed` が 0 であること。** 1 件でも残っていれば `reveal.js` の掃引が効いていない。

- [ ] **Step 3: `prefers-reduced-motion` を確認する**

DevTools の Rendering パネルで `prefers-reduced-motion: reduce` をエミュレートして再読み込みし、次を確認する。

```js
({
  unrevealed: document.querySelectorAll(".reveal:not(.is-in)").length,  // 0
  displayOpacity: getComputedStyle(document.querySelector(".display")).opacity, // "1"
  lineTransform: getComputedStyle(document.querySelector(".lines .ln > i")).transform, // "none"
})
```

- [ ] **Step 4: 全テストを実行する**

Run: `node --test`
Expected: PASS。Task 1・3・4・5・7 の 40 件前後がすべて成功。

- [ ] **Step 5: `CLAUDE.md` を書き換える**

次の点を反映する。

1. **クイックスタート**: 「ブラウザで直接開く」を削除する。ES モジュールを使うため `file://` では動かない。`python3 -m http.server 8000` のみを案内する
2. **アーキテクチャ概要**: 単一 HTML の 3 セクション構成という記述を、Task の File Structure の表に差し替える
3. **データ構造**: 3 種類のイベント形式の説明を、`startDay` / `endDay` に統一した 1 種類の説明に差し替える。`time` 文字列を持たないことを明記する
4. **よく使う開発タスク**: 「新しいイベントを追加」は `assets/data/events.json` を編集する手順にする（Phase B で UI から編集できるようになる旨も添える）
5. **カレンダーグリッドの高さを変更**: `tokens.css` の `--hour-h` と `calendar.js` の `HOUR_H` の両方を合わせる旨に書き換える
6. **外部ライブラリ**: Leaflet を CDN からセルフホストに変更したこと、およびその理由（Phase B でトークンを保存するため）を書く
7. **テスト**: `node --test` で純粋関数のテストが走ること、描画はブラウザで数値を測って確認することを追記する
8. **カラーを変更**: `tokens.css` を編集し、`node --test tests/tokens.test.js` でコントラストを検証する手順にする

- [ ] **Step 6: `README.md` を書き換える**

1. プロジェクト構成の図を実際のファイル構成に更新する
2. カラーパレットの記述（スターバックスグリーン）を新パレットに差し替える
3. タイポグラフィの記述（Fraunces / DM Sans）を Newsreader / Inter / Noto Sans JP / Noto Serif JP に差し替える
4. ローカル開発の手順から「ブラウザで直接開く」を削除する
5. 「イベント構造」の 3 形式の説明を 1 形式に統一する
6. 最終更新日を 2026-08-09 にする

- [ ] **Step 7: 旧ファイルの残骸がないことを確認する**

```bash
grep -rn "Fraunces\|DM Sans\|006241\|1E3932\|f2f0eb\|Material+Symbols\|unpkg.com" \
  --include="*.html" --include="*.css" --include="*.js" --include="*.md" . \
  | grep -v "docs/design-reference/" | grep -v "docs/superpowers/"
```

Expected: 何も出ない。出た場合はその箇所を直す。

`docs/design-reference/mock-aman.html` は参照用なので対象外。

- [ ] **Step 8: コミット**

```bash
git add CLAUDE.md README.md assets/css/calendar.css
git commit -m "$(cat <<'EOF'
Update docs for the multi-page structure

Local development now requires a server: ES modules do not load over
file://. The old "just open index.html" instruction would fail
silently with a CORS error, so it is removed rather than softened.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Phase A の完了を確認する**

最後に通しで確認する。

```bash
node --test
python3 -m http.server 8000
```

4 ページを開き、次がすべて満たされていること。

| 確認項目 | 期待 |
|---|---|
| `node --test` | 全件 PASS |
| コンソールエラー | 0 件（favicon の 404 は除く） |
| 未解決の `<use>` | 0 件 |
| `.reveal:not(.is-in)` | 最下部までジャンプ後も 0 件 |
| 横溢れ（390px / 1440px） | 4 ページとも なし |
| CDN からの JS 読み込み | なし |
| カレンダーのイベント | 列からのはみ出し 0 件 |
| 日またぎ（バンコクホテル・パタヤホテル） | それぞれ 3 セグメントに分割表示 |
| 地図のピン / ロケーション一覧 | 17 件 |

---

## Self-Review

**Spec coverage（Phase A の範囲）**

| 設計書の項目 | 対応するタスク |
|---|---|
| 2.2 ファイル構成（Phase A 分） | Task 1, 6, 7, 8, 9, 10, 11 |
| 3.2 / 3.3 トークンとフォント代替 | Task 5 |
| 3.4 カテゴリ色の 3 値セット | Task 5（数値テストつき） |
| 3.5 インライン SVG | Task 7 |
| 3.6 モーションと reveal の掃引 | Task 6, 12 |
| 3.7 レスポンシブ | Task 9（CSS）、Task 12（検証） |
| 4.1 events.json のスキーマ | Task 2, 3 |
| 6.4 CDN 依存の排除 | Task 10 |
| 7.2 カレンダーと地図 | Task 9, 10 |
| 7.2 詳細シート（読み取り） | Task 11 |
| 10 検証方針 | Task 12 |

Phase A の対象外（意図的に含めない）: 5 章の保存と公開、6.1〜6.3 の認証と暗号化、7.2 の予定エディタ、7.3 持ち物、7.4 検索、7.5 コメント、8 章の変換スクリプト。

**Placeholder scan**: 「適切なエラー処理を追加」「詳細は後で」のような記述はなし。CSS の一部は `docs/design-reference/mock-aman.html` の行番号を指定して参照させているが、これは実在する検証済みファイルであり、変更点は各タスクに明記してある。

**Type consistency**: `expandEvents(events, dayCount)` の戻り値 `Segment` は Task 3 で定義し、Task 4 の `assignLanes` と Task 9 の `renderCalendar` が同じ形（`ref` / `day` / `start` / `end` / `lane` / `laneCount`）で受けている。`CAT_META` は Task 9 で定義し Task 10・11 が import。`icon(id, extraClass)` の引数順は全タスクで統一。`CATEGORY_ICON` は Task 7 で定義し Task 9・10・11 が使用。

**修正した点**: Task 11 の `draw()` が `main()` スコープの `openDetail` を参照できない問題を Step 3 で明示し、`state.onSelect` 経由にする指示を入れた。
