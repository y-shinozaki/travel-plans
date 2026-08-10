/**
 * お土産リストのテスト用データ。
 *
 * 実データ（assets/data/souvenirs.json）は暗号文なので読めない。
 * ここが持っている性質を減らすと、対応するテストが「通るが何も検査していない」
 * 状態になる。
 *
 * 意図的に含めてある性質:
 * - bought が true の行と false の行（進捗が両方を数えること）
 * - note が空の行と、note を持つ行
 * - recipient が空の行（「何を」だけ決まっていて相手が未定。空文字を許す設計）
 * - shop が重複する 2 行（候補が重複を落とすこと）
 * - shop が空の行（候補が空文字を拾わないこと）
 */
export const SOUVENIRS = {
  updatedAt: "2026-08-10T00:00:00.000Z",
  items: [
    {
      id: "sv-001",
      name: "ドライマンゴー",
      recipient: "会社",
      shop: "空港",
      note: "5袋くらい",
      bought: true,
    },
    {
      id: "sv-002",
      name: "タイパンツ",
      recipient: "弟",
      shop: "チャトチャック市場",
      note: "",
      bought: false,
    },
    {
      id: "sv-003",
      name: "石けん",
      recipient: "母",
      shop: "チャトチャック市場",
      note: "香りの強すぎないもの",
      bought: false,
    },
    { id: "sv-004", name: "トムヤムクンの素", recipient: "", shop: "", note: "", bought: false },
  ],
};
