# タイ 2026 旅行計画

タイ旅行（2026年8月12日～17日）のスケジュールとマップを管理するマルチページアプリケーション。

**ライブサイト**: https://y-shinozaki.github.io/travel-plans/

## 機能

- 時間別スケジュール表示（表示時間帯はカスタマイズ可能）
- Leaflet と CartoDB Positron タイルを使用したインタラクティブマップ
- カテゴリによるイベントフィルタリング
- 詳細シートでのイベント情報表示
- **ブラウザ上での予定の追加・編集・削除**（下書きは端末の `localStorage` に保存）
- **「公開」でリポジトリへ反映**（GitHub Contents API 経由。トークンを設定した端末のみ）
- モバイル、タブレット、デスクトップに対応
- ビルドプロセス不要 — ローカルサーバーを起動するだけ

現在実装済みなのはメニュー（`index.html`）と旅程カレンダー（`schedule.html`）で、
旅程は画面から編集・公開できる。
持ち物リスト（`packing.html`）と検索アーカイブ（`archive.html`）は Phase B2/C 向けの仮ページで、
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
`tests/` は時刻変換・イベント展開・レーン配置・アイコン・デザイントークンの純粋関数と
静的な値に加えて、保存と公開の層（`store` / `base64` / `sync-decide` / `github` / `sync`）、
編集フォームとエディタ、公開画面、4 ページの CSP を検証する。通信・`localStorage`・時刻は
すべて差し替え可能にしてあるので、テストは外部と通信しない。
カレンダー描画やレスポンシブ崩れなど、DOM に依存する部分はブラウザで目視・実測して確認する。

## プロジェクト構成

```
travel-plans/
├── index.html            メニュー
├── schedule.html          旅程カレンダーと地図（編集・公開もここ）
├── packing.html           持ち物リスト（Phase B2 の仮ページ）
├── archive.html           検索アーカイブ（Phase C の仮ページ）
├── assets/
│   ├── css/
│   │   ├── tokens.css     色・余白・角丸・モーションの唯一の定義場所
│   │   ├── base.css       リセット、タイポグラフィ、共通レイアウト、reveal 演出
│   │   ├── controls.css   ボタン・チップ・入力欄・詳細シート・編集フォーム・公開まわり
│   │   └── calendar.css   schedule.html 専用（カレンダー・地図・レスポンシブ）
│   ├── js/                menu.js / schedule.js / stub-page.js（各ページのエントリポイント）、
│   │                      countdown.js（メニューの出発カウントダウン）、
│   │                      calendar.js / map.js / sheet.js / nav.js / reveal.js / icons.js、
│   │                      categories.js / dom.js / validate.js（共通部品）、
│   │                      time.js / events.js / lanes.js（node --test が対象にする純粋関数）、
│   │                      store.js / base64.js / sync-decide.js / github.js / token.js /
│   │                      sync.js（下書きの保存とリポジトリへの公開）、
│   │                      event-form.js / event-editor.js / publish-ui.js（編集と公開の画面）
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

### 予定の編集

- 「予定を追加」で新規作成、イベントを選んで「この予定を編集」で既存の編集。削除は 2 度押し
- 保存すると `localStorage` の下書きに入り、リロードしても残る。この時点ではリポジトリは変わらない
- ダイアログ（`alert` / `confirm`）は使わない。入力の不備はシートの中に一覧で出る

### レスポンシブデザイン

- 1180px 以下: メニューの3カラムグリッド、セクション見出し、地図とサイドリストが1カラムに変わる
- 760px 以下: セクション間の余白が縮み、カレンダーは横スクロール（時間列は左に固定）に切り替わる

## 保存と公開

- **正はリポジトリの `assets/data/events.json`。** 同行者はページを開くだけで最新を受け取る
- **編集は端末の `localStorage` に下書きとして入る**（キーは `tp:events`、
  最後にリモートと揃えた時刻が `tp:events-base`）
- **「公開」を押した端末だけ**が GitHub Contents API でリポジトリへコミットする。
  トークンを設定していない端末には公開ボタン自体が出ない（閲覧と下書き編集はできる）
- 新旧の判定はどちらも JSON トップレベルの `updatedAt`。公開の直前にもリモートを取り直して
  突き合わせ、別の端末が先に公開していれば送信せずに中断する
  （sha だけでは「相手が編集中に公開した」形の競合を捕まえられないため）
- 公開後、GitHub Pages への反映には 1 分ほどかかる

### 公開用トークンの作り方

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. Repository access: **このリポジトリだけ**（`y-shinozaki/travel-plans`）
3. Permissions: **Contents = Read and write のみ**
4. **有効期限を設定する**（旅行終了後まで）
5. 旅程ページの「公開用トークンを設定」に貼り付けて保存

**トークンをコミットしないこと。** リポジトリにもコードにも書かない。保存先は入力した端末の
ブラウザの `localStorage["tp:gh-token"]` だけで、**平文**で入る（暗号化はしていない）。
画面はトークンを一切表示し直さず、「設定済み／未設定」だけを出す。
共用端末では使い終わったら設定画面の「削除」で消すこと。

## アーキテクチャ

### データフロー

```
sync.load()（assets/js/sync.js）
  ├ assets/data/events.json を素の fetch（トークン不要）
  ├ localStorage の下書きと突き合わせ、どちらを見せるかを決める
  └ validateEvents() で形を検査してから渡す
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

このリポジトリへの書き込み権限を持つ GitHub トークンをブラウザに保存している。
CDN 経由で読み込むスクリプトが差し替えられた場合、そのトークンを盗み出されたり、
リポジトリへ任意の内容を push されたりする恐れがあるため、サードパーティの JS は CDN から
読み込まず `assets/vendor/leaflet/` に自前で配置している。同じ理由で、4 ページすべてに
`script-src 'self'` の Content-Security-Policy を置き、インライン script を排除している。
トークンの具体的な保存先・扱いは
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
- Safari（iOS 15.5 以上 — 詳細シートが背景の隔離に使う `inert` の対応バージョン）

## ライセンス

プライベートプロジェクト

## 作成者

y-shinozaki

---

**最終更新**: 2026年8月9日
