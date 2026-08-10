/**
 * 旅程の形をした合成データ。expandEvents / collectLocations / assignLanes を
 * 通すためのフィクスチャで、実際の旅程とは関係がない。
 *
 * Phase B4 で assets/data/events.json が暗号文になり、テストから中身を読めなく
 * なったため、data.test.js の「パイプラインに通す」側をここへ移した
 * （経緯は data.test.js の冒頭コメント）。
 *
 * 実データが持っていた性質を意図的に再現してある。**減らさないこと** ──
 * どれか 1 つでも欠けると、対応するテストが「通るが何も検査していない」状態になる:
 *
 * - 同じ座標を持つ 2 件（重複除去が効くこと）
 * - 座標を持たない終日イベント（lat/lng が両方 null の形）
 * - 複数日にまたがるイベント（日ごとのセグメントに割れること）
 * - 日をまたぐ移動（start > end。**入れ替えて「直さない」こと**）
 * - 同じ日に時間が重なる 2 件（レーンが 2 本以上になること）
 * - **5 つのカテゴリすべて**（絞り込みで件数が減ること、catMeta / iconOf が全部通ること）
 * - **カテゴリ既定でない `icon` を持つ 1 件**（icons.test.js のループが 0 回にならないこと。
 *   これが無いと「通るが何も検査していない」テストになる）
 */

export const ITINERARY = {
  updatedAt: "2026-01-01T00:00:00.000Z",
  days: [
    { date: "1/10", dow: "土" },
    { date: "1/11", dow: "日" },
    { date: "1/12", dow: "月" },
  ],
  events: [
    {
      id: "fx-001",
      cat: "cat-move",
      title: "空港へ移動",
      allDay: false,
      startDay: 0,
      endDay: 0,
      start: 10,
      end: 12,
      location: "中央駅",
      lat: 35.1,
      lng: 139.1,
      url: "",
      notes: "",
      image: "",
      imagePos: "",
    },
    {
      id: "fx-002",
      cat: "cat-food",
      title: "駅ナカで昼食",
      allDay: false,
      startDay: 0,
      endDay: 0,
      start: 12,
      end: 13,
      // fx-001 と同じ座標。collectLocations がここを 1 地点にまとめる
      location: "中央駅",
      lat: 35.1,
      lng: 139.1,
      url: "",
      notes: "",
      image: "",
      imagePos: "",
    },
    {
      id: "fx-003",
      cat: "cat-sight",
      title: "展望台",
      allDay: false,
      startDay: 0,
      endDay: 0,
      // fx-001（10:00–12:00）と重なる。レーンが 2 本になる唯一の理由
      start: 11,
      end: 13,
      location: "展望台",
      lat: 35.2,
      lng: 139.2,
      url: "",
      notes: "",
      // 空でない image / imagePos を 1 件だけ持たせてある。
      // event-editor.test.js の「フォームに無い項目が併合で消えないこと」は、
      // これが空だと検査対象が 0 件になり素通りする（mergeEvent を外しても通る）
      image: "https://example.com/view.jpg",
      imagePos: "center 30%",
    },
    {
      id: "fx-004",
      cat: "cat-hotel",
      title: "ホテル連泊",
      allDay: true,
      startDay: 0,
      endDay: 2,
      // 終日イベントは start / end のキー自体を持たない
      location: "ホテル",
      // 地図に出さないので両方 null。片方だけ null にすると検査で弾かれる
      lat: null,
      lng: null,
      url: "",
      notes: "",
      image: "",
      imagePos: "",
    },
    {
      id: "fx-005",
      cat: "cat-move",
      title: "夜行便",
      // カテゴリ既定（cat-move → i-car）ではない個別指定。
      // icons.test.js が「個別の icon がスプライトに実在するか」を見る対象になる
      icon: "i-flight",
      allDay: false,
      startDay: 1,
      endDay: 2,
      // 21:55 発 → 翌 06:20 着。start > end は日をまたぐ正しい形
      start: 21.92,
      end: 6.33,
      location: "空港",
      lat: 35.3,
      lng: 139.3,
      url: "",
      notes: "",
      image: "",
      imagePos: "",
    },
    {
      id: "fx-006",
      cat: "cat-shop",
      title: "土産物",
      allDay: false,
      startDay: 2,
      endDay: 2,
      start: 9,
      end: 10,
      location: "市場",
      lat: 35.4,
      lng: 139.4,
      url: "",
      notes: "",
      // image を持つ 2 件目。1 件しかないと「複数件で確かめる」テストが
      // 成り立たない（実データでは 24 件あった）
      image: "https://example.com/market.jpg",
      imagePos: "",
    },
  ],
};
