/**
 * 持ち物リストのテスト用データ。
 *
 * 実データ（assets/data/packing.json）は暗号文なので読めない。
 * ここが持っている性質を減らすと、対応するテストが「通るが何も検査していない」
 * 状態になる ── 各テストにその番人となる下限のアサーションを置いてある。
 *
 * 意図的に含めてある性質:
 * - 区分が 2 つ以上（並べ替えと区分間移動のテストに要る）
 * - 中身が空の区分（進捗の割り算がゼロ除算にならないこと）
 * - note が空の項目と、note を持つ項目
 * - a と b でチェック状態が違う項目（進捗が別々に出ること）
 */
export const PACKING = {
  updatedAt: "2026-08-10T00:00:00.000Z",
  members: { a: "雄一", b: "朱汰" },
  groups: [
    {
      id: "g-valuables",
      name: "貴重品・書類",
      icon: "i-lock",
      items: [
        { id: "passport", name: "パスポート", note: "残存6か月以上", a: true, b: true },
        { id: "cash", name: "現金（バーツ）", note: "", a: true, b: false },
        { id: "insurance", name: "海外旅行保険の控え", note: "", a: false, b: false },
      ],
    },
    {
      id: "g-clothes",
      name: "衣類",
      icon: "i-luggage",
      items: [{ id: "swimwear", name: "水着", note: "パタヤ用", a: false, b: true }],
    },
    {
      id: "g-empty",
      name: "あとで足す",
      icon: "i-note",
      items: [],
    },
  ],
};
