/**
 * お土産リストの純粋なデータ操作。DOM も store も知らない。
 *
 * packing-data.js と同じ考え方で、「壊れたときの失われ方が静かな部分」を
 * ここへ集めてある ── 「追加したら別の行が消えていた」は、次にそのリストを
 * 見るまで誰も気付かない。
 *
 * すべての関数は新しいオブジェクトを返し、渡されたデータを変更しない。
 * 描画の途中で配列を書き換えると、保存されるものと画面に出ているものが食い違う。
 *
 * **持ち物（packing-data.js）と違い、階層も members も持たない。** 理由は
 * 設計書 §4.5 ── 区分を挟むと相手軸と店軸のどちらか一方でしか読めなくなり、
 * 贈り先は行ごとの自由記述なので事前に列挙できない。
 */

/** 何も無い状態のお土産リスト。 */
export function emptySouvenirs() {
  return { items: [] };
}

/**
 * 既存と衝突しない id を採番する。
 *
 * 件数から作った候補が埋まっていれば次を試す。途中を削除したデータでは
 * 件数と最大値がずれるので、「使われていないこと」を必ず確かめる
 * （packing-data.js の nextId と同じ理由 ── id が重複すると、
 * チェックの切り替えが別の行に飛ぶ）。
 */
export function nextSouvenirId(items) {
  const used = new Set(items.map((i) => i?.id));
  for (let n = used.size + 1; ; n++) {
    const id = `sv-${String(n).padStart(3, "0")}`;
    if (!used.has(id)) return id;
  }
}

/**
 * 1 行を差し替えた（同じ id が無ければ末尾に足した）新しいデータを返す。
 * 差し替えは位置を変えない ── 編集するたびに行が動いたら読めなくなる。
 */
export function withSouvenir(data, item) {
  const index = data.items.findIndex((i) => i?.id === item.id);
  const items =
    index === -1
      ? [...data.items, item]
      : data.items.map((i, n) => (n === index ? item : i));
  return { ...data, items };
}

/** 1 行を取り除いた新しいデータを返す。 */
export function withoutSouvenir(data, id) {
  return { ...data, items: data.items.filter((i) => i?.id !== id) };
}

/**
 * 買った数と全体。
 *
 * total を分母に使う側（進捗バー）がゼロ除算にならないよう、件数をそのまま返して
 * 割り算は呼び出し側に任せる。1 行も無い状態は実際に起こる。
 *
 * `=== true` で見る ── `"false"` のような文字列を真として数えない
 * （検査で弾くが、進捗が黙って狂う種類の壊れ方なので二重に守る）。
 */
export function progressOf(data) {
  let done = 0;
  for (const item of data.items) {
    if (item?.bought === true) done++;
  }
  return { done, total: data.items.length };
}

/**
 * 入力済みの店名を、重複なく出現順で返す。
 *
 * 「どこで」は自由入力にした（設計書 §7.6）。旅程の買物スポットから選ばせると
 * 2 つの JSON が相互に依存し、旅程からその予定を消した瞬間にお土産側の参照が
 * 迷子になる。表記の揺れは、この候補を datalist に出すことで実用上は防ぐ。
 *
 * 五十音順に並べ替えない ── 直前に入力した店が先頭付近に残るほうが、
 * 同じ店の行を続けて足すときに速い。
 */
export function shopSuggestions(data) {
  const seen = [];
  for (const item of data.items) {
    const shop = item?.shop;
    if (typeof shop === "string" && shop !== "" && !seen.includes(shop)) {
      seen.push(shop);
    }
  }
  return seen;
}
