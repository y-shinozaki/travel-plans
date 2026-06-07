# タイ 2026 旅行計画

タイ旅行（2026年8月12日～17日）のスケジュールとマップを管理するシングルページアプリケーション。

**ライブサイト**: https://y-shinozaki.github.io/travel-plans/

## 機能

- 時間別スケジュール表示（表示時間帯はカスタマイズ可能）
- Leaflet と CartoDB Voyager タイルを使用したインタラクティブマップ
- カテゴリと日付による位置情報フィルタリング
- サイドパネルでのイベント詳細表示
- マップ上でホテル表示/非表示を切り替え
- モバイル、タブレット、デスクトップに完全対応
- ビルドプロセス不要 - `index.html` を開くだけ

## 技術スタック

- **HTML5、CSS3**: シングルファイルアプリケーション（セマンティック構造）
- **JavaScript**: フレームワークを使用しないバニラ JavaScript
- **Leaflet.js**: インタラクティブマップライブラリ
- **Google Fonts**: Fraunces（セリフ表示用）、DM Sans（サンセリフ本文用）
- **Material Symbols**: イベントアイコンライブラリ

## はじめ方

### ローカル開発

ビルドツール不要。以下のいずれかで実行：

```bash
# ブラウザで直接開く
open index.html

# または Python でローカルサーバーを起動
python3 -m http.server 8000
# その後 http://localhost:8000 にアクセス
```

## プロジェクト構成

```
travel-plans/
├── index.html          シングルページアプリケーション（すべてのコードを含む）
├── DESIGN.md           デザインシステムとカラーパレットドキュメント
├── schedule.csv        イベントデータ（HTML の <script> 内に埋め込み）
├── README.md           このファイル
├── .claude/settings.json
├── .mcp.json
└── .gitignore
```

## デザインシステム

詳細については [DESIGN.md](./DESIGN.md) を参照。

**カラーパレット**:

- プライマリ: スターバックスグリーン（#006241）
- アクセント: グリーン（#00754A）
- ダーク: ハウスグリーン（#1E3932）
- キャンバス: ニュートラルウォーム（#f2f0eb）

**タイポグラフィ**:

- 見出し: Fraunces（セリフ体、WONK バリエーション付き）
- 本文: DM Sans（サンセリフ体）

## 主な機能

### カレンダービュー

- 時間別スロットの横軸タイムライン（表示時間帯: 6am～10pm をカスタマイズ可能）
- 複数日にまたがるイベントはカレンダーセルを横断表示
- イベントをクリックするとサイドパネルに詳細を表示

### マップ連携

- 時間指定イベントのすべてに位置情報マーカーを表示
- ホテルと終日イベントは別リストに表示
- マップ上でホテル表示/非表示を切り替え可能
- マーカークリックで位置情報詳細をハイライト

### イベントフィルタリング

- カテゴリ（食事、観光など）でフィルタリング
- 日付でフィルタリング
- マップマーカーと位置情報リストをリアルタイムで更新

### レスポンシブデザイン

- 960px 以下の画面では縦並びレイアウト
- 600px 以下ではサイドパネルが全幅表示
- モバイルフレンドリータップターゲット

## アーキテクチャ

### データフロー

```
イベント（<script> で定義）
  ↓
expandEvents() → 複数日イベントを日単位セグメントに変換
  ↓
renderCalendar() → 時間スロットグリッドを生成
collectLocations() → 緯度経度を抽出、重複を排除
  ↓
buildFilteredLocations() → フィルターを適用
  ↓
buildLocationList() → カードを描画、マップを更新
```

### イベント構造

イベントは 3 つのタイプをサポート：

**時間指定イベント**（カレンダーとマップに表示）:

```javascript
{
  title: "レストランでランチ",
  icon: "restaurant",
  start: "2026/08/13 12:00",
  end: "2026/08/13 13:30",
  location: "バンコク",
  lat: 13.7563,
  lng: 100.5018,
  category: "food"
}
```

**複数日イベント**（カレンダーの複数セルにまたがる）:

```javascript
{
  title: "バンコクホテル",
  icon: "hotel",
  multiDay: true,
  startDay: 0,
  endDay: 2,
  startHour: 15,
  endHour: 11,
  location: "137 ピラーズ レジデンス バンコク",
  lat: 13.7325,
  lng: 100.5064
}
```

**終日イベント**（マップマーカーなし、ホテルリストのみ）:

```javascript
{
  title: "ホテル滞在",
  icon: "hotel",
  allDay: true,
  start: "2026/08/12",
  end: "2026/08/14",
  location: "バンコク"
  // 注意: 緯度経度がないため、マップには表示されません
}
```

## カスタマイズ

### カラー変更

`index.html` の `:root` セクション内の CSS 変数を更新：

```css
--dark: #1e3932;
--green: #006241;
--green-mid: #00754a;
--canvas: #f2f0eb;
```

すべてのカラーは CSS 変数として定義する必要があります。ハードコードされた16進数値は使用しないでください。

### カレンダーグリッドの高さを調整

`<script>` セクション内の `HOUR_H = 44` を変更し、`.cal-day-col` CSS の repeating-linear-gradient 背景も合わせて更新。

### 時間表示範囲を変更

`<script>` ブロック内の `viewStart` と `viewEnd` 変数を編集し、`buildOptions()` のドロップダウンオプションも更新。

### マップタイルを変更

`<script>` セクション内の `L.tileLayer()` URL を置換。現在は CartoDB Voyager を使用。代替案: Stamen Watercolor、Esri World Imagery、OpenStreetMap。

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

**最終更新**: 2026年6月7日
