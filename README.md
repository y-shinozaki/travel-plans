# タイ 2026 旅行計画

タイ旅行（2026年8月12日～17日）のスケジュールとマップを管理するマルチページアプリケーション。

**ライブサイト**: https://y-shinozaki.github.io/travel-plans/

## 機能

- 時間別スケジュール表示（表示時間帯はカスタマイズ可能）
- Leaflet と CartoDB Positron タイルを使用したインタラクティブマップ
- カテゴリによるイベントフィルタリング
- 詳細シートでのイベント情報表示
- モバイル、タブレット、デスクトップに対応
- ビルドプロセス不要 — ローカルサーバーを起動するだけ

現在実装済みなのはメニュー（`index.html`）と旅程カレンダー（`schedule.html`）。
持ち物リスト（`packing.html`）と検索アーカイブ（`archive.html`）は Phase B/C 向けの仮ページで、
「メニューへ戻る」リンクのみ用意されている（`archive.html` は合言葉によるログインを予定しているが未実装）。

## 技術スタック

- **HTML5、CSS3**: 4 ページ構成。色・余白・角丸・モーションは `assets/css/tokens.css` の
  CSS カスタムプロパティに集約
- **JavaScript**: フレームワークを使用しないバニラ JavaScript（ES モジュール）
- **Leaflet.js**: インタラクティブマップライブラリ。CDN ではなく `assets/vendor/leaflet/` に
  セルフホスト（理由は後述）
- **Google Fonts**: Newsreader / Noto Serif JP（見出し）、Inter / Noto Sans JP（本文）
- インラインの SVG スプライト（`assets/js/icons.js`）をアイコンに使用。Material Symbols フォントは未使用

## はじめ方

### ローカル開発

ビルドツール不要。ただし JS はすべて ES モジュールとして読み込むため、`index.html` を
`file://` で直接開くと CORS エラーになり画面が真っ白になる。**必ずローカルサーバーを経由すること。**

```bash
python3 -m http.server 8000
# その後 http://localhost:8000 にアクセス
```

### テスト

```bash
node --test
```

`package.json` は `"type": "module"` を宣言するためだけに存在し、依存パッケージはゼロ。
`tests/` は時刻変換・イベント展開・レーン配置・アイコン・トークンの純粋関数と静的な値を検証する。
カレンダー描画やレスポンシブ崩れなど、DOM に依存する部分はブラウザで目視・実測して確認する。

## プロジェクト構成

```
travel-plans/
├── index.html            メニュー
├── schedule.html          旅程カレンダーと地図
├── packing.html           持ち物リスト（Phase B の仮ページ）
├── archive.html           検索アーカイブ（Phase C の仮ページ）
├── assets/
│   ├── css/
│   │   ├── tokens.css     色・余白・角丸・モーションの唯一の定義場所
│   │   ├── base.css       リセット、タイポグラフィ、共通レイアウト、reveal 演出
│   │   ├── controls.css   ボタン・チップ・入力欄・詳細シート
│   │   └── calendar.css   schedule.html 専用（カレンダー・地図・レスポンシブ）
│   ├── js/                menu.js / schedule.js（各ページのエントリポイント）、
│   │                      calendar.js / map.js / sheet.js / nav.js / reveal.js / icons.js、
│   │                      categories.js / dom.js（ページをまたいで使う共通部品）、
│   │                      time.js / events.js / lanes.js（node --test が対象にする純粋関数）
│   ├── data/
│   │   └── events.json    旅程データ（唯一のソース。表示用文字列は持たない）
│   └── vendor/
│       └── leaflet/       Leaflet 1.9.4 のセルフホスト版
├── tests/                 node --test 用のテスト
├── DESIGN.md              デザインシステムのドキュメント
├── CLAUDE.md
└── README.md              このファイル
```

## デザインシステム

詳細については [DESIGN.md](./DESIGN.md) を参照。出典は aman.com の computed style（2026-08-09 実測）。

**カラーパレット**（`assets/css/tokens.css`）:

- 主背景 `--sand`（`#f3eee7`）、副背景・カード面 `--sand-lt`（`#fdf9f5`）— 純白を主背景に使わない
- 本文色 `--ink`（`#313131`）、副次テキスト `--ink-2`（`#585858`）
- カテゴリ（移動・観光・食事・宿泊・買物）はそれぞれアクセント／ティント地／文字の3値セットを持つ

有彩色のブランドカラーは持たず、無彩色のサンド・アイボリー系を基調にしている。
色を変更する場合は必ず `tokens.css` の CSS 変数を編集し、`node --test tests/tokens.test.js` で
コントラスト比が壊れていないことを確認すること。

**タイポグラフィ**:

- 見出し（`--serif`）: Newsreader、和文は Noto Serif JP
- 本文（`--sans`）: Inter、和文は Noto Sans JP

いずれも Lyon / Whitney（aman.com が使う有償フォント）の無料の近似として選定した。

## 主な機能

### カレンダービュー

- 時間別スロットの縦軸タイムライン（表示時間帯: 6時～22時をカスタマイズ可能）
- 複数日にまたがるイベント（連泊するホテルなど）は日ごとのセグメントに分割してカレンダーセルを横断表示
- イベントをクリックすると詳細シートに情報を表示

### マップ連携

- 座標を持つイベントに位置情報マーカーを表示
- カテゴリでフィルタリングすると、マップと位置情報リストが連動して更新

### レスポンシブデザイン

- 1180px 以下: メニューの3カラムグリッド、セクション見出し、地図とサイドリストが1カラムに変わる
- 760px 以下: セクション間の余白が縮み、カレンダーは横スクロール（時間列は左に固定）に切り替わる

## アーキテクチャ

### データフロー

```
assets/data/events.json（fetch）
  ↓
expandEvents() → 複数日イベントを日単位セグメントに変換
assignLanes()  → 重なるイベントにレーンを割り当てる
  ↓
renderCalendar() → 時間スロットグリッドを描画
map.js の createMap() → 座標を持つイベントからマーカーと位置情報リストを構築
```

### イベント構造

イベントは 1 種類の形式に統一されている（`startDay` / `endDay` で単日・複数日の両方を表現する）。
表示用の時刻文字列（`"12:30 → 13:30"` のようなもの）は JSON に持たせず、
`assets/js/time.js` の `timeLabel(ev)` が `start` / `end` / `allDay` から都度生成する。

```javascript
{
  id: "ev-006",
  cat: "cat-move",              // cat-move / cat-sight / cat-food / cat-hotel / cat-shop
  title: "出国フライト（依田家）",
  allDay: false,                 // true なら終日表示（ホテルの宿泊行など）
  startDay: 0,                   // 日インデックス（0 始まり）
  endDay: 0,                     // 複数日にまたがる場合は startDay より後ろになる
  start: 10.58,                  // 10進時間（10.58 ≈ 10:35）
  end: 15.08,                    // 10進時間（15.08 ≈ 15:05）
  location: "スワンナプーム国際空港",
  lat: 13.69,
  lng: 100.7501,                 // 地図に出さない場合は null
  url: "",
  notes: "便名: タイ国際航空 TG683 (HND→BKK)",
  image: "",
  imagePos: "",
}
```

## カスタマイズ

### カラー変更

`assets/css/tokens.css` の CSS 変数を更新する。

```css
--sand: #f3eee7;
--ink: #313131;
--c-hotel: #2f566f;
--c-hotel-bg: #d8e6f4;
--c-hotel-tx: #1c3446;
```

すべての色は CSS 変数として定義する必要がある。ハードコードされた16進数値は使用しないこと。
変更後は `node --test tests/tokens.test.js` でコントラスト比のテストを実行して確認する。

### カレンダーグリッドの高さを調整

`assets/css/tokens.css` の `--hour-h` と `assets/js/calendar.js` の `HOUR_H` は同じ値を指す。
必ず両方を同時に変更すること。

### 時間表示範囲を変更

`assets/js/schedule.js` の `state.viewStart` / `state.viewEnd` の初期値を編集する。

### マップタイルを変更

`assets/js/map.js` 内の `L.tileLayer()` URL を置換する。現在は CartoDB Positron
（`rastertiles/light_all`）を使用。低彩度で無彩色基調のページに馴染むための選択で、
彩度の高い Voyager はあえて採用していない（`map.js` 冒頭のコメント参照）。
代替案: Stamen Watercolor、Esri World Imagery、OpenStreetMap。

## Leaflet をセルフホストする理由

Phase B でこのリポジトリへの書き込み権限を持つ GitHub トークンをブラウザに保存する予定がある。
CDN 経由で読み込むスクリプトが差し替えられた場合、そのトークンを盗み出されたり、
リポジトリへ任意の内容を push されたりする恐れがあるため、サードパーティの JS は CDN から
読み込まず `assets/vendor/leaflet/` に自前で配置している。トークンの具体的な保存先・扱いは
`docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md` §5.4・§6.4 を参照。

## デプロイメント

このリポジトリは GitHub Pages にデプロイされています。

### 初回セットアップ:

1. リポジトリの Settings → Pages に移動
2. Source を選択: `main` ブランチ、ルートディレクトリ
3. 保存

### デプロイ方法:

`main` ブランチにプッシュ。サイトは自動更新されます。

## ブラウザサポート

- Chrome/Edge（最新版）
- Firefox（最新版）
- Safari（iOS 14 以上）

## ライセンス

プライベートプロジェクト

## 作成者

y-shinozaki

---

**最終更新**: 2026年8月9日
