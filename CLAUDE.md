# CLAUDE.md

このファイルは、このリポジトリで Claude Code (claude.ai/code) を使用する際のガイダンスを提供します。

## クイックスタート

ビルドツール不要。ただし JS はすべて `<script type="module">` で読み込むため、
`file://` で直接開くと CORS エラーになり、ページが何も表示されないまま失敗する。
必ずローカルサーバー経由でアクセスすること。

```bash
python3 -m http.server 8000
# その後 http://localhost:8000 にアクセス
```

## アーキテクチャ概要

### ファイル構成（Phase A 時点）

```
travel-plans/
├── index.html / schedule.html   実装済み（メニュー／旅程カレンダー・地図）
├── packing.html / archive.html  Phase B/C の仮ページ（リンクのみ、中身は未実装）
├── assets/
│   ├── css/
│   │   ├── tokens.css      色・余白・角丸・モーションの唯一の定義場所
│   │   ├── base.css        リセット、タイポグラフィ、共通レイアウト、reveal 演出、
│   │   │                   メニューとセクション見出しのレスポンシブ
│   │   ├── controls.css    ボタン・チップ・チェックボックス・入力欄・詳細シート
│   │   └── calendar.css    schedule.html 専用（カレンダー・地図・レスポンシブ）
│   ├── js/
│   │   ├── time.js         10進時間 ⇔ HH:MM 変換、timeLabel()
│   │   ├── events.js       expandEvents()（複数日イベントを日単位セグメントに展開）
│   │   ├── lanes.js        assignLanes()（重なるイベントのレーン配置）
│   │   ├── icons.js        インライン SVG スプライトの注入と icon()（スプライトのみを扱う）
│   │   ├── categories.js   CAT_META（ラベル・既定アイコン）、catMeta() / iconOf() /
│   │   │                   accentToken() / accentColor()。カテゴリの知識はここだけ
│   │   ├── dom.js          el() / makeSelectable() / escapeHtml()（描画の共通部品）
│   │   ├── calendar.js     renderCalendar()、HOUR_H
│   │   ├── map.js          Leaflet 初期化、位置情報リスト、popupHtml() / locationRowHtml()
│   │   ├── sheet.js        詳細シート（読み取り専用）、renderEventDetail()
│   │   ├── nav.js          ページ間ナビ
│   │   ├── reveal.js       IntersectionObserver によるスクロール出現演出
│   │   ├── menu.js         index.html のエントリポイント
│   │   └── schedule.js     schedule.html のエントリポイント
│   ├── data/
│   │   └── events.json     旅程データの唯一のソース（表示用文字列は持たない）
│   └── vendor/
│       └── leaflet/        Leaflet 1.9.4 を自前で配置（理由は「外部ライブラリ」参照）
├── tests/                  node --test で実行する純粋関数・静的検証のテスト
├── DESIGN.md               デザイン仕様（aman.com 由来）
└── docs/design-reference/mock-aman.html   検証済みの参照実装（実装対象ではなく、値を写す元）
```

設計書（`docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md` §2.3）によると、
今後 2 フェーズで以下が追加される予定:

- **Phase B**（保存・公開フロー、予定エディタ、持ち物リストとエディタ、コメント機能）:
  `assets/js/store.js` `sync.js` `comments.js`、`assets/css/packing.css`、
  `assets/data/packing.json` `comments.json` など
- **Phase C**（変換スクリプト、暗号化、認証、検索アーカイブ）:
  `assets/js/auth.js` `crypto.js`、`assets/css/archive.css`、`assets/data/archive.enc`、
  `tools/build-archive.mjs`、`private/`（.gitignore 対象）など

いずれもこの CLAUDE.md ではなく設計書を正とする。

### イベントのデータ構造

イベントは `assets/data/events.json` の `events` 配列に 1 種類の形式で格納する
（旧版にあった「時間指定／複数日／終日」の 3 形式は廃止し、`startDay` / `endDay` に統一した）。

```javascript
{
  id: "ev-006",
  cat: "cat-move",              // cat-move / cat-sight / cat-food / cat-hotel / cat-shop
  title: "出国フライト（依田家）",
  allDay: false,                 // true ならホテル欄などの終日表示。true のときは start/end キー自体を持たない
  startDay: 0,                   // 日インデックス（0 始まり）
  endDay: 0,                     // 複数日にまたがる場合はここが startDay より後ろになる
  start: 10.58,                  // 10進時間。10.58 ≈ 10:35
  end: 15.08,                    // 15.08 ≈ 15:05
  location: "スワンナプーム国際空港",
  lat: 13.69,
  lng: 100.7501,                 // 地図に出さない場合（ホテルの終日行など）は lat/lng を null にする
  url: "",
  notes: "便名: ...",
  image: "",
  imagePos: "",
}
```

**表示用の文字列（`"10:35 → 15:05"` のようなもの）は JSON に持たせない。**
`assets/js/time.js` の `timeLabel(ev)` が `start` / `end` / `allDay` から都度生成する。
複数日イベントは `assets/js/events.js` の `expandEvents()` が日ごとのセグメントに展開してから描画する。

**重要な定数:**

- `HOUR_H`（`assets/js/calendar.js`）: カレンダーグリッドの 1 時間あたりのピクセル高さ。
  `assets/css/tokens.css` の `--hour-h` と必ず同じ値にすること（詳細は後述）。

### データフロー

```
assets/data/events.json（fetch）
  ↓
expandEvents() → 複数日イベントを日単位のセグメントに変換
assignLanes()  → 同じ日・重なる時間帯のセグメントにレーンを割り当てる
  ↓
renderCalendar() → 時間スロットグリッドを描画（viewStart/viewEnd を尊重）
map.js の createMap() → 座標を持つイベントからマーカーと位置情報リストを構築
  ↓
カテゴリフィルター変更時に再描画
```

## デザインシステム

すべての色・余白・角丸・モーションの値は `assets/css/tokens.css` の CSS カスタムプロパティに定義する。
**ハードコードされた 16 進数値をコード中に書かないこと。** 色を変える／確認する手順は後述の
「カラーを変更」を参照。パレットの出典と設計意図は `DESIGN.md` を参照。

## よく使う開発タスク

### 新しいイベントを追加

1. `assets/data/events.json` の `events` 配列にオブジェクトを追加する
   （Phase A では手編集。Phase B で UI から編集・保存できるようになる予定）
2. `id` は一意な文字列、`cat` は `cat-move` / `cat-sight` / `cat-food` / `cat-hotel` / `cat-shop` のいずれか
3. 単日・時間指定なら `startDay` と `endDay` を同じ値にし、`start` / `end` を10進時間で設定
4. 複数日にまたがる場合は `endDay` を `startDay` より後ろにする
5. 終日イベント（ホテルなど）は `allDay: true` にする。地図に出さない場合は `lat` / `lng` を `null` にする
6. 保存後、ブラウザをリロードすれば反映される（ビルドステップなし）

### カレンダーグリッドの高さを変更

`assets/css/tokens.css` の `--hour-h` と `assets/js/calendar.js` の `HOUR_H` は同じ値を指す必要がある。
**必ず両方を同時に変更すること。** 片方だけ変えると、時間軸の目盛りとイベントブロックの高さがずれる。

### カレンダーの時間範囲を変更

`assets/js/schedule.js` の `state.viewStart` / `state.viewEnd` の初期値を編集する。
これは**セレクトの初期選択値**であって、選択肢の範囲ではない。

選択肢の範囲は同ファイルの `START_HOUR_CHOICES`（0〜12）と `END_HOUR_CHOICES`（13〜24）
という別の定数で決まり、`fillHourOptions()` にそのまま渡される。範囲を
`state.viewStart` / `viewEnd` から導くと選択肢が 1 個しかないセレクトになるため、
意図的に分けてある。初期値は必ず対応する範囲に収まる値にすること
（範囲外にすると、どの option も選択されていないセレクトになる）。

### マップタイルを更新

`assets/js/map.js` 内の `L.tileLayer()` 呼び出しの URL を置換する。現在は CartoDB Positron
（`rastertiles/light_all`）を使用。Voyager は彩度が高く、無彩色基調のページから浮くため採用していない
（`map.js` 冒頭のコメント参照）。代替案: Stamen Watercolor、Esri World Imagery、OpenStreetMap デフォルト。

### カラーを変更

1. `DESIGN.md` で対象の役割（Surface / Category など）を確認する
2. `assets/css/tokens.css` の CSS 変数を更新する。ハードコードした 16 進値をコードに書かない
3. `node --test tests/tokens.test.js` を実行し、コントラスト比・色差のテストが通ることを確認する
   （彩度や明度を動かしすぎると可読性のテストが失敗する）

## 外部ライブラリ

```html
<!-- Google Fonts: Newsreader（セリフ表示用）、Inter（サンセリフ本文用）、
     Noto Sans JP / Noto Serif JP（和文） -->
<link
  href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,200;6..72,300;6..72,400&family=Inter:wght@300;400;500&family=Noto+Sans+JP:wght@300;400;500&family=Noto+Serif+JP:wght@200;300;400&display=swap"
  rel="stylesheet"
/>

<!-- Leaflet はセルフホスト。assets/vendor/leaflet/ に配置しており CDN からは読み込まない -->
<link rel="stylesheet" href="assets/vendor/leaflet/leaflet.css" />
<script src="assets/vendor/leaflet/leaflet.js"></script>
```

**Leaflet を CDN からセルフホストへ変更した理由**: Phase B でこのリポジトリへの書き込み権限を持つ
GitHub トークンをブラウザに保存する予定がある。CDN 経由のスクリプトが差し替えられた場合、
そのトークンを盗み出されたり、リポジトリへ任意の内容を push されたりする恐れがあるため、
サードパーティの JS を一切 CDN から読み込まない方針にした。トークンの具体的な保存先・扱いは
`docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md` §5.4・§6.4 を参照
（この CLAUDE.md では詳細を重複させない — 設計変更のたびにここが古くなるのを避けるため）。
Leaflet を更新する際は `assets/vendor/leaflet/` 配下のファイルを手動で差し替える。

アイコンは Material Symbols フォントではなく、`assets/js/icons.js` が注入するインライン SVG スプライト
（`<svg class="ico"><use href="#i-xxx"/></svg>`）を使う。

## テスト

```bash
node --test
```

依存ゼロ、ビルド不要。`tests/` 配下は `time.js` / `events.js` / `lanes.js` / `icons.js` /
`categories.js` / `tokens.css` の純粋関数・静的な検証と、`tests/renderers.test.js` の
エスケープ検証を対象にしている（`package.json` は `"type": "module"` を宣言するためだけに存在する）。

`tokens.test.js` は色そのものに加えて次の 2 つの約束も機械的に守らせている:

- `--hour-h`（tokens.css）と `HOUR_H`（calendar.js）が同じ値であること
- `base.css` / `controls.css` / `calendar.css` に色リテラルを書かないこと
  （半透明が必要なら `rgb(var(--ink-rgb) / 0.14)` のようにチャンネルトークンを使う）

`renderers.test.js` の `renderCalendar` のテストは、`document.createElement` だけを備えた
最小スタブを噛ませて「どの文字列が `innerHTML` に入り、どれが `textContent` に入ったか」を
記録して検証している。

地図の実際の挙動（Leaflet の fitBounds / flyTo）・reveal 演出・レスポンシブ崩れなど、
本物の DOM やブラウザの computed style に依存する部分は
`node --test` ではカバーできない。ブラウザの DevTools で実際に数値を測って確認すること
（横溢れの有無、`--hour-h` と `HOUR_H` の一致、`prefers-reduced-motion` 時の可視性など）。

## レスポンシブデザイン

**ブレークポイント:**

- **1180px 以下**: メニューの3カラムグリッドとセクション見出しの2カラムが1カラムに変わる
  （`assets/css/base.css`）。地図とサイドリストの2カラムも1カラムになる（`assets/css/calendar.css`）
- **760px 以下**: セクション間の余白 `--s8` が 154px から 96px に縮む（`assets/css/base.css`）。
  カレンダーは6列を1画面に収めず横スクロールにし、時間列（`.cal__gutter` など）を
  `position: sticky; left: 0` で固定する（`assets/css/calendar.css`）

すべてのブレークポイントは各 CSS ファイル内の `@media` クエリで定義。
`@media (prefers-reduced-motion: reduce)` は `assets/css/base.css` にあり、
`.reveal` の不透明度を強制的に `1` にすることで、演出が無効化されてもコンテンツが
半永久的に不可視のままになる事故を防いでいる。

## ブラウザサポート

- Chrome/Edge（最新版）
- Firefox（最新版）
- Safari（iOS 15.5 以上）

詳細シートは背景を `inert` で隔離している（`assets/js/sheet.js`）。`inert` は
Safari 15.5 で対応したため、これがサポート下限を決めている。これより古い Safari では
閉じたシートの閉じるボタンがタブ移動で到達でき、支援技術からも隠れない。

## デプロイメント

`main` ブランチへのプッシュで GitHub Pages 自動デプロイ:

1. リポジトリ設定で Pages を有効化（ソース: `main` ブランチ、ルートディレクトリ）
2. `main` にプッシュ — サイトは自動更新
3. ライブ: `https://y-shinozaki.github.io/travel-plans/`

## 今後の開発に向けたノート

- 状態管理ライブラリなし — 各ページの `<script type="module">`（例: `assets/js/schedule.js`）が
  モジュールスコープの `state` オブジェクトを持つ。ページをまたぐ共有状態はまだない
- コンポーネントフレームワークなし — DOM 構築は `document.createElement` ベースのヘルパー
  （`dom.js` の `el()`）と一部 `innerHTML` の併用。**イベント由来の文字列を `innerHTML` に
  そのまま流し込まないこと。** 平文なら `el()`（`textContent`）を使い、どうしても
  `innerHTML` に載せる必要があるときは `dom.js` の `escapeHtml()` を必ず通す。
  `tests/renderers.test.js` が 3 つの描画経路すべてについてこれを検証している。
  Phase B ではブラウザで入力した文字列を、リポジトリ書き込み権限を持つトークンを
  抱えたページ自身で描画することになるため、この規約は必須
- Leaflet MarkerCluster は未実装。イベント密度が大幅に増加した場合に追加検討
- Dancing Script（旧デザインの筆記体タイトル）は Aman 由来のデザインへの刷新に伴い廃止した。
  現在の見出しフォントは `--serif`（Newsreader / Noto Serif JP）
