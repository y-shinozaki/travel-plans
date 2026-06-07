# CLAUDE.md

このファイルは、このリポジトリで Claude Code (claude.ai/code) を使用する際のガイダンスを提供します。

## クイックスタート

ビルドツール不要。シングルページ HTML アプリケーション。

```bash
# 方法1: ブラウザで直接開く
open index.html

# 方法2: Python 3 でローカルサーバーを起動
python3 -m http.server 8000
# その後 http://localhost:8000 にアクセス
```

## アーキテクチャ概要

### シングル HTML ファイル (`index.html`)

アプリケーション全体が 1 つのファイルに含まれ、3 つのメインセクションからなります：

1. **`<style>` ブロック**（行 14～1075）
   - CSS カスタムプロパティ（トークン）: カラー、間隔、タイポグラフィ
   - レスポンシブブレークポイント: 960px（カレンダーレイアウト）、600px（モバイル）
   - コンポーネントスタイル: ヒーロー、カレンダーグリッド、マップ、位置情報フィルター、詳細パネル
   - アニメーション: fadeUp、cardIn、reveal エフェクト

2. **`<body>` HTML**（行 1078～1165）
   - セマンティック構造: ヒーロー → スケジュール → マップセクション → フッター → 詳細パネル
   - カレンダーコンテナ（`#cal`）
   - Leaflet マップコンテナ（`#leaflet-map`）
   - フィルターボタンと位置情報リスト

3. **`<script>` ブロック**（行 1167～終了）
   - イベントデータ: `days[]`、`catMeta{}`、`events[]`
   - コア関数: `renderCalendar()`、`collectLocations()`、`expandEvents()`
   - Leaflet + CartoDB Voyager タイルを使用したマップ初期化
   - フィルター状態: `locFilter`、`viewStart`、`viewEnd`、`showHotels`

### キーとなるデータ構造

**イベントオブジェクト**（3 つのタイプ）:

```javascript
// タイプ1: 時間指定イベント（単一日、カレンダーとマップに表示）
{ d: 0, cat: 'cat-food', icon: 'restaurant', title: '...',
  start: 12.5, end: 13.5, time: '12:30 → 13:30',
  location: '...', lat: 13.7563, lng: 100.5018, notes: '...' }

// タイプ2: 複数日イベント（複数のカレンダーセルと日にまたがる）
{ multiDay: true, startDay: 0, endDay: 2, startHour: 15, endHour: 11,
  cat: 'cat-hotel', icon: 'hotel', title: '...',
  location: '...', lat: 13.7278, lng: 100.5601, notes: '...' }

// タイプ3: 終日イベント（マップマーカーなし、ホテルリストのみ）
{ d: 0, icon: 'hotel', title: '...', allDay: true, time: '終日',
  location: '...', notes: '' }
```

**重要な定数:**

- `HOUR_H = 44`: カレンダーグリッドの 1 時間あたりのピクセル高さ

### データフロー

```
イベント（生データ）
  ↓
expandEvents() → 複数日イベントを日単位のセグメントに変換
  ↓
renderCalendar() → 時間スロットグリッド（viewStart/viewEnd を尊重）
collectLocations() → 緯度経度を抽出、座標ごとに重複排除
  ↓
buildFilteredLocations() → カテゴリ + 日付フィルターを適用
buildLocationList() → カードを描画、マーカー表示を更新
```

### 時間フォーマット

イベントは 10 進数時間フォーマットを使用（例: `12.5` = 12:30、`15.08` = 15:04）:

```javascript
start: 10.58,  // 10:35 (0.58 * 60 ≈ 35 分)
end: 15.08     // 15:05 (0.08 * 60 ≈ 5 分)
```

変換式: `時間 + (分 / 60)`。

### マップ＆フィルター状態

```javascript
let locFilter = { cat: null, day: null }; // null = すべて表示
let viewStart = 6,
  viewEnd = 22; // カレンダー時間範囲
let showHotels = false; // ホテル表示/非表示切り替え
```

フィルター変更時は `buildFilteredLocations()` と `buildLocationList()` を呼び出します。

## デザインシステム

すべてのカラーは CSS カスタムプロパティ（`:root` で定義）:

- `--dark`: ブラック（#000000） — フッター、見出し
- `--green`: ブラック（#000000） — 見出し
- `--green-mid`: チャコール（#333333） — セカンダリテキスト
- `--canvas`: クラフト紙クリーム（#f6f6f3） — ページ背景
- `--ceramic`: カードサーフェス（#e5e5e1） — イベントカード背景

詳細なパレットとタイポグラフィシステムは `DESIGN.md` を参照。

**ハードコードされた 16 進数値を使用しないでください。** 常に CSS 変数を使用してください。

## よく使う開発タスク

### 新しいイベントを追加

1. `<script>` ブロック内の `events` 配列に追加
2. 時間指定の場合: `d`（日インデックス）、`start`/`end`（10 進数時間）、`location`、`lat`/`lng` を設定
3. 複数日の場合: `multiDay: true` で `startDay`、`endDay`、`startHour`、`endHour` を設定
4. 終日（ホテル）の場合: `allDay: true` を設定、`lat`/`lng` は省略
5. `cat` キーでカテゴリ化（例: `'cat-food'`、`'cat-sight'`）
6. `icon`（Material Symbol 名）、`title`、`notes` を含める
7. 関数はページ読み込み時に自動実行。ライブプレビューはブラウザをリロード

### カレンダーグリッドの高さを変更

1. `HOUR_H` 定数を更新（行 ~1170）
2. `.cal-day-col` の背景画像 repeating-linear-gradient を同じ値で更新:
   ```css
   repeating-linear-gradient(
     to bottom,
     transparent 0px,
     transparent ${HOUR_H - 1}px,
     var(--border) ${HOUR_H - 1}px,
     var(--border) ${HOUR_H}px
   );
   ```

### カレンダーの時間範囲を変更

1. `<script>` ブロック内の `viewStart` と `viewEnd` を修正（行 ~1285）
2. `buildOptions()` 関数のドロップダウンオプションも同じ値で更新

### マップタイルを更新

マップ初期化の `L.tileLayer()` 呼び出しを置換:

```javascript
L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  },
).addTo(map);
```

代替案: Stamen Watercolor、Esri World Imagery、OpenStreetMap デフォルト。

### カラーを変更

1. `DESIGN.md` でカラーを探す（例: Tsutaya Red）
2. `:root` 内の CSS 変数を更新（行 ~16）
3. すべての使用箇所が自動的に変更を継承

## 外部ライブラリ

すべて CDN から読み込み、npm/ビルドステップなし:

```html
<!-- Google Fonts: Dancing Script (hero), Noto Sans JP (body/display) -->
<link
  href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Noto+Sans+JP:wght@300;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0&display=swap"
/>

<!-- Leaflet (マッピング) -->
<link
  rel="stylesheet"
  href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

Leaflet 更新時は `<link>` と `<script>` タグのバージョンを一致させてください。

## レスポンシブデザイン

**ブレークポイント:**

- **960px**: マップ + サイドバーが縦並びに変更、ヒーロータイトルが縮小
- **600px**: 詳細パネルが全幅表示、モバイル最適化パディング、ヒーロースクロール指標が非表示

すべてのブレークポイントは `<style>` ブロック内の `@media` クエリで定義。

## ブラウザサポート

- Chrome/Edge（最新版）
- Firefox（最新版）
- Safari（iOS 14 以上）

## デプロイメント

`main` ブランチへのプッシュで GitHub Pages 自動デプロイ:

1. リポジトリ設定で Pages を有効化（ソース: `main` ブランチ、ルートディレクトリ）
2. `main` にプッシュ — サイトは自動更新
3. ライブ: `https://y-shinozaki.github.io/travel-plans/`

## 今後の開発に向けたノート

- 状態管理ライブラリなし — グローバル変数（`viewStart`、`showHotels`、`locFilter`）は許容。複雑度が増せば将来的にリファクタリングを検討
- コンポーネントフレームワークなし — すべての DOM 更新は `innerHTML` 経由（ユーザー入力がないため安全）
- Leaflet MarkerCluster は未実装。イベント密度が大幅に増加した場合に追加検討
- Dancing Script（ヒーロータイトル用筆記体）はデザイン方針による意図的な選択 — 削除しないでください
