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
 *
 * 制約: `//` や `/* *\/` のコメントは見ていない。コメント内に `[` や `]` が
 * あると depth がずれて誤った範囲を返しうる（現行データでは該当箇所なし、
 * 確認済み）。この関数自身では切り詰めを検知できないため、
 * 最後の砦として下の EXPECTED による実測値チェックがある。
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

/**
 * 実測値による検算。
 * sliceArrayLiteral が括弧を数え違えて配列を途中で切り上げても、
 * 切り出したテキストだけを見ている限り自己矛盾しないので気づけない。
 * 外から測った既知の値と突き合わせるのが、唯一この失敗を捕まえられる方法。
 * データを意図的に増減させたときは、ここも一緒に更新すること。
 */
const EXPECTED = {
  days: 6,
  events: 40,
  allDay: 5,
  multiDay: 3,
  withCoords: 21,
};

const html = readFileSync(SRC, "utf8");
const days = runInNewContext(sliceArrayLiteral(html, "days"));

const eventsSource = sliceArrayLiteral(html, "events");
const rawEvents = runInNewContext(eventsSource);

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

const actual = {
  days: days.length,
  events: events.length,
  allDay: events.filter((e) => e.allDay).length,
  multiDay: events.filter((e) => e.endDay > e.startDay).length,
  withCoords: events.filter((e) => e.lat != null).length,
};

for (const key of Object.keys(EXPECTED)) {
  if (actual[key] !== EXPECTED[key]) {
    throw new Error(
      `件数が実測値と一致しません（${key}）: 期待値 ${EXPECTED[key]} に対して実際 ${actual[key]}`
    );
  }
}

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
