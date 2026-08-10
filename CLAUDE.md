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

### ファイル構成（Phase B2 時点）

```
travel-plans/
├── index.html / schedule.html / packing.html
│                             実装済み（メニュー〈合言葉の入力〉／旅程カレンダー・地図・
│                             編集・公開／持ち物リストとエディタ）
├── assets/
│   ├── css/
│   │   ├── tokens.css      色・余白・角丸・モーションの唯一の定義場所
│   │   ├── base.css        リセット、タイポグラフィ、共通レイアウト、reveal 演出、
│   │   │                   メニューとセクション見出しのレスポンシブ
│   │   ├── controls.css    ボタン・チップ・チェックボックス・入力欄・詳細シート・
│   │   │                   編集フォーム・公開まわり（パネル／状態表示／同期バー）・
│   │   │                   ツールバー（`.toolbar` 系。Phase B2 で calendar.css から移設）
│   │   ├── calendar.css    schedule.html 専用（カレンダー・地図・レスポンシブ）。
│   │   │                   `.toolbar select` だけは schedule 専用なのでここに残る
│   │   └── packing.css     packing.html 専用（Phase B2）。色リテラル検査
│   │                       （tokens.test.js）の対象ファイルにも入っている
│   ├── js/
│   │   ├── time.js         10進時間 ⇔ HH:MM 変換、timeLabel()
│   │   ├── events.js       expandEvents()（複数日イベントを日単位セグメントに展開）
│   │   ├── lanes.js        assignLanes()（重なるイベントのレーン配置）
│   │   ├── icons.js        インライン SVG スプライトの注入と icon()（スプライトのみを扱う）
│   │   ├── categories.js   CAT_META（ラベル・既定アイコン）、catMeta() / iconOf() /
│   │   │                   accentToken() / accentColor()。カテゴリの JS 側の定義
│   │   │                   （色の実体は tokens.css と calendar.css。後述の3ファイル）
│   │   ├── validate.js     validateEvent()（1件）と validateEvents()（全体）。
│   │   │                   イベント1件の規則の置き場所はここ1か所だけ。EventDataError は
│   │   │                   Phase B2 で追加した data-error.js の DataError を継承する
│   │   ├── countdown.js    index.html の「出発まで あと N 日」（DOM に触らない）
│   │   ├── dom.js          el() / makeSelectable() / escapeHtml() / safeHttpUrl()
│   │   ├── calendar.js     renderCalendar()、HOUR_H
│   │   ├── map.js          Leaflet 初期化、位置情報リスト、popupHtml() / locationRowHtml()
│   │   ├── sheet.js        詳細シートの器、renderEventDetail()
│   │   ├── nav.js          ページ間ナビ
│   │   ├── reveal.js       IntersectionObserver によるスクロール出現演出
│   │   │  ── ここから下が Phase B1 で追加した保存・公開・編集の層 ──
│   │   ├── store.js        localStorage の薄いラッパ（createStore / StoreWriteError）
│   │   ├── base64.js       UTF-8 対応の base64 変換（btoa は日本語で例外になる）
│   │   ├── sync-decide.js  decideSync()。ローカルとリモートのどちらを採るかの純粋関数
│   │   ├── github.js       GitHub Contents API の呼び出し（createGitHub / GitHubError）
│   │   ├── token.js        公開用トークンの置き場所（tp:gh-token の唯一の出入口）
│   │   ├── sync.js         下書きとリモートを束ねる層（load / saveLocal /
│   │   │                   adoptRemote / publish / hasUnpublishedChanges）。config は
│   │   │                   6 つの注入口を持つ（後述「保存と公開」）
│   │   ├── event-form.js   編集フォームの HTML・入力の読み取り・formProblems()
│   │   ├── event-editor.js 採番・併合・保存・削除。シートにフォームを載せる
│   │   ├── publish-ui.js   トークン設定・公開ボタン・起動時の案内バー。content（validate
│   │   │                   と noun の組）を必須で受け取り、旅程・持ち物の両方から使う
│   │   │  ── ここから下が Phase B4 で追加した合言葉と暗号化の層 ──
│   │   ├── crypto.js       同期する JSON の暗号化と復号（封筒 codec、AES-GCM。DOM も
│   │   │                   store も fetch も知らない）
│   │   ├── auth.js         合言葉から導いた鍵の置き場所（`tp:key` の唯一の出入口）
│   │   ├── auth-form.js    合言葉フォームの組み立て（index.html。DOM は menu.js から
│   │   │                   注入で受け取り、自分では document を触らない）
│   │   ├── load-error.js   読み込み失敗の分類と文言（純粋関数）。classifyLoadError() は
│   │   │                   Phase B2 で { noun, path } を取る一般形になった（既定は旅程）
│   │   ├── menu.js         index.html のエントリポイント
│   │   ├── schedule.js     schedule.html のエントリポイント
│   │   ├── stub-page.js    仮ページ用の共通エントリポイント。参照していた packing.html が
│   │   │                   Phase B2 で実装されたため、現在は参照するページが無い
│   │   │  ── ここから下が Phase B2 で追加した持ち物リストの層 ──
│   │   ├── data-error.js       DataError。EventDataError（validate.js）と
│   │   │                       PackingDataError（packing-validate.js）に共通の基底
│   │   ├── packing-validate.js validatePacking()。validate.js と同じ方針（不備は
│   │   │                       1 件目で止めず全部集めて名指しする）
│   │   ├── packing-data.js     持ち物リストの純粋なデータ操作（追加・移動・区分を
│   │   │                       またぐ移動・併合）。DOM も store も知らない
│   │   ├── packing-render.js   持ち物リストの描画。通常時は読むだけ、編集モードで
│   │   │                       操作コントロールが増える
│   │   ├── packing-drag.js     Pointer Events による並べ替え。DOM を正として、
│   │   │                       指を離した時点で配列を組み直す
│   │   └── packing.js          packing.html のエントリポイント
│   ├── data/
│   │   └── events.json     旅程データの唯一のソース（表示用文字列は持たない）。
│   │                       packing.json は同じ場所に無い ── 最初の「公開」まで
│   │                       リポジトリに存在せず、それまでは 404 を空のリストとして扱う
│   └── vendor/
│       └── leaflet/        Leaflet 1.9.4 を自前で配置（理由は「外部ライブラリ」参照）
├── tests/                  node --test で実行する純粋関数・静的検証のテスト
├── DESIGN.md               デザイン仕様（aman.com 由来）
└── docs/design-reference/mock-aman.html   検証済みの参照実装（実装対象ではなく、値を写す元）
```

設計書（`docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md` §2.3）によると、
残りのフェーズで以下が追加される予定:

- **Phase B3**（コメント機能）: `assets/js/comments.js`、`assets/data/comments.json` など

**Phase B4（合言葉と暗号化）は完了した。** `assets/js/auth.js` `crypto.js` `auth-form.js`、
`index.html` の合言葉入力、`sync.js` の暗号化対応を追加した。**同期する JSON は
暗号文になる**（現時点で同期しているのは `events.json` と B2 で足した `packing.json` だが、
B3 で足す `comments.json` も同じ鍵・同じソルトで暗号化する設計になっている）。
仮ページ `archive.html` の削除もここで行った（後述「暗号化（Phase B4）」参照）。

**Phase B2（持ち物リストとエディタ）は完了した。** `assets/css/packing.css`、
`assets/js/packing.js` / `packing-data.js` / `packing-validate.js` / `packing-render.js` /
`packing-drag.js`、共通の `data-error.js` を追加し、`packing.html` を実装済みページに
した。旅程用に作られていた `createSync()` の `config`（後述「保存と公開」）と
`createPublishUI()` の `content` を、2 つ目の JSON（`packing.json`）が実際に使う形で
検証できたのはこのフェーズが初めて。経緯は設計書 §13 を参照。

**旧 Phase C（Gmail / LINE の検索アーカイブ）は 2026-08-09 に取りやめた。**
`archive.enc`・`tools/build-archive.mjs`・`assets/css/archive.css` は作らない。

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
sync.load()（assets/js/sync.js）
  ├ assets/data/events.json を素の fetch（トークン不要）
  ├ localStorage の下書き（tp:events）と突き合わせる
  └ validateEvents() → リモートも下書きも、見せる前に形を検査する。
    通らなければ（リモート側なら）ここで止める
  ↓
expandEvents() → 複数日イベントを日単位のセグメントに変換
assignLanes()  → 同じ日・重なる時間帯のセグメントにレーンを割り当てる
  ↓
renderCalendar() → 時間スロットグリッドを描画（viewStart/viewEnd を尊重）
map.js の createMap() → 座標を持つイベントからマーカーと位置情報リストを構築
  ↓
表示時間帯の変更時・カテゴリフィルター変更時・予定の保存時・取り込み時に再描画
（すべて schedule.js の safeDraw を通す）
```

## 保存と公開（Phase B1 / B4）

設計書 §5 に対応する。**この節の記述と設計書が食い違ったら設計書を正とする。**

### 下書きと正

- **正はリポジトリの `assets/data/events.json`。** 同行者はページを開くだけで最新を受け取る
- **編集は即座に `localStorage` へ入る（下書き）。** ブラウザを閉じても残る。
  リポジトリには入らない
- **「公開」を押した端末だけが**、GitHub Contents API 経由でリポジトリへコミットする。
  トークンを持たない端末は閲覧と下書き編集のみ（公開ボタン自体が置かれない）

`localStorage` のキーは `store.js` が `tp:` を前置する。使うのは 6 つ:

| キー | 中身 | 書く場所 |
|---|---|---|
| `tp:events` | 旅程の下書き（`events.json` と同じ形＋`updatedAt`。**平文のまま**保存する） | `sync.js` の `DEFAULT_CONFIG.draftKey` |
| `tp:events-base` | 旅程を最後にリモートと揃えた時点の `updatedAt` 文字列 | `sync.js` の `DEFAULT_CONFIG.baseKey` |
| `tp:packing` | 持ち物リストの下書き（`packing.json` と同じ形＋`updatedAt`。平文のまま） | `packing.js` が `createSync()` に渡す `config`（Phase B2 で追加） |
| `tp:packing-base` | 持ち物リストを最後にリモートと揃えた時点の `updatedAt` 文字列 | 同上 |
| `tp:gh-token` | 公開用トークン（平文） | `token.js` |
| `tp:key` | 合言葉から導いた鍵素材（`salt.iter.key` を `.` 区切りで連結） | `auth.js` |

キー名を他のファイルに書き写さないこと。`tp:events` / `tp:events-base` を知っているのは
`sync.js`（の既定 `DEFAULT_CONFIG`）、`tp:packing` / `tp:packing-base` を知っているのは
`packing.js` が組み立てる `config` だけ、`tp:gh-token` は `token.js`、`tp:key` は
`auth.js`（唯一の出入口）だけ。
（この 6 つのほかに `publish-ui.js` が `tp:write-probe` を一瞬だけ書いて消す。
保存領域に書けるかを実際に試すためで、残さない。）

**`createSync()` の `config` は owner / repo / branch / path に加えて
`draftKey` / `baseKey` / `validate` / `commitMessage` / `codec` / `noun` の 6 つを持つ**
（既定値は旅程用: `sync.js` の `DEFAULT_CONFIG` 参照）。5 つだったところへ Phase B2 で
`noun`（画面の文言に使う名詞。「最新の◯◯を確認できませんでした」の◯◯）が 6 つ目として
加わった。2 つ目の JSON（B2 で実装した `packing.json`。`packing.js` 参照）を実際に
動かして確認済みなので、B3 で 3 つ目（`comments.json`）を足すときは `packing.js` の
`createSync()` の呼び出しを写すこと。**6 つのうち一部だけを差し替えると、旅程の下書きが
黙って消える**（`noun` だけは表示専用で取り違えてもデータは壊れないが、「危険なものだけ」
に絞ると毎回どれが危険かを思い出す必要が生じるため、同じ組に入れてある。詳しい経緯は
設計書 §13）。

`createPublishUI()` にも同じ形の旅程専用の依存が残っていたが、B2 で発見して解消した
（`content: { validate, noun }` を必須の組で受け取るようにした。片方だけ渡せてしまうと
「持ち物データが旅程の検証に落ちて公開が必ず失敗する」か「持ち物ページの通知が
旅程の話をする」のどちらかが起きるため、あえて別々の任意引数にしなかった。経緯は
設計書 §13）。

### `updatedAt` がすべての比較の軸

各 JSON はトップレベルに `updatedAt`（ISO8601）を持つ。`saveLocal()` と `publish()` が
現在時刻に進める。判断は 2 か所で行う:

1. **起動時** — `sync-decide.js` の `decideSync()` が
   `remote.updatedAt` / 下書きの `updatedAt` / `tp:events-base` を突き合わせ、
   `use-remote` / `use-local` / `remote-is-newer` / `offline` のいずれかを返す。
   `remote-is-newer` のときは画面上部にバーを出し、「取り込む」か「自分の変更を残す」かを
   人に選ばせる。**黙ってリモートで上書きしない**（同行者の手元の変更を消さないため）。
   `offline` のときは「最新の確認ができなかった」ことだけを伝えるバーを出し、機能は落とさない
2. **公開時** — `sync.js` の `assertRemoteNotAhead()` が、GET した本文の `updatedAt` を
   `tp:events-base` と比べる。進んでいれば PUT を飛ばさずに 409 で止める

「未公開の変更があるか」は `sync.hasUnpublishedChanges()` が
**下書きの `updatedAt` と `tp:events-base` の一致**で判定する（大小ではない）。
`decideSync` の戻り値から導かないこと — `use-local` は「リモートが進んでいない」であって
「編集がある」ではなく、一度も編集していない端末も 2 回目の読み込みから `use-local` になる。

**`decideSync()` の比較は意図的に混ざっている。片方を他方に揃えないこと。**

- `remote` と `base` は**大小**で比べる。どちらも「リモートファイルの `updatedAt`」という
  同じ系列の値だから（`base` に入るのは `storeAdopted()` が渡された本文から取った値。
  `publish()` 経由なら自端末の時計で押した直後の値だが、それはそのまま PUT する
  本文の `updatedAt` でもある）。ただし公開する端末が複数あって時計がずれていれば
  この系列自体が単調でなくなる — 設計書 §13 の残存リスクがそれ
- 下書きと `base` は**一致**で比べる。`base` は公開した端末の時計、下書きの `updatedAt` は
  編集した端末の時計で押される別系列の値で、順序に意味がない。ここを大小にすると、
  公開側の時計が進んでいる間に編集した下書きが `base` より古くなり、
  「触られていない」と読まれて `load()` が黙って上書きする ──
  トークンを持たない端末の編集は git 履歴にも残らないので、そのまま消える。
  `hasUnpublishedChanges()` が一致で見ているのと同じ理由

### 暗号化（Phase B4）

設計書 §6 に対応する。

- **リモートのファイルは封筒 JSON。** `updatedAt` を暗号文の外に複製し、
  `kdf`（`salt` / `iter`）・`iv`・`ct` を持つ（`assets/js/crypto.js` の `createCodec()`）。
  **外側を暗号文の外に置いたのは、`assertRemoteNotAhead()` が競合検出のために
  復号せずとも `updatedAt` を読めるようにするため**（前述「競合検出は sha ではなく
  `updatedAt`」）。外側は GCM の認証タグの外にあるため改竄・破損を検知できず、
  中身の `updatedAt` と食い違うことがある。読み込みは中身を正として表示しつつ、
  食い違いを画面に警告として出す（`schedule.js` の `outerStampMismatch`）
- **下書きは平文のまま `localStorage` に置く。** `tp:events` は暗号化しない ──
  鍵を失っても手元の未公開の編集は読める
- **導出鍵は `localStorage["tp:key"]`。知っているのは `auth.js` だけ。** 合言葉から
  PBKDF2（600,000 回）で導いた鍵を保存し、以降は保存済みの鍵を読むだけで済ませる
  （端末ごとに PBKDF2 が走るのは最初の 1 回だけ）
- **ソルトは同期する JSON（`events` / 将来の `packing` / `comments`）で共有する。**
  ファイルごとにソルトを引くと、2 つ目の JSON を足した時点で別の鍵になり、
  ページを移動するたびに PBKDF2 600,000 回が走る（設計書 §6.3）
- **読み込みの順序**（`sync.js` の `load()`）: fetch → 復号 → 検証。復号は
  `codec.decode()` が担い、封筒でない値（`ct` を持たない平文）はそのまま素通しする
  （移行当日に 1 回だけ通る経路）。検証はそのあとの `validateEvents()`
- **公開の順序**（`sync.js` の `publish()`）: 検証 → 暗号化 → GET で sha と本文 →
  `updatedAt` の突き合わせ → PUT → `tp:events-base` を更新（詳細は次項「公開の順序」）
- **合言葉を忘れると復旧できない。** git 履歴に残るのも暗号文で、合言葉以外に
  鍵を再現する手段はない。**控えをパスワードマネージャに残すこと**

### 競合検出は sha ではなく `updatedAt`（設計書 §5.3）

GET の直後に PUT するので **sha はほぼ常に最新**であり、409 が返るのは GET と PUT の間の
数十ミリ秒に別の公開が挟まった場合だけ。現実の競合は「B がページを開いて 30 分編集する間に
A が公開する」という形で起きる。この場合 PUT の直前に取り直した sha は新しいので
**PUT は成功し、A の作業が黙って消える**。だから公開前に GET の本文の `updatedAt` を見る。
`sha` は `putFile` に渡すが、409 は最後の保険であって主たる検出手段ではない。

（設計書 §5.3 は当初 sha を主たる検出手段と書いていた。Task 7 のレビューで訂正済み。）

### 公開の順序（`sync.js` の `publish()`）

```
validateEvents → 暗号化 → GET で sha と本文 → updatedAt の突き合わせ → PUT → tp:events-base を更新
```

順序に意味がある。検証を後ろへ回すと壊れたデータがリポジトリに入り、同行者のページが
起動しなくなる。base を PUT より前に進めると、失敗した公開が「同期済み」に見える。
暗号化は検証と GET の間に固定の位置を持つ ── 検証より前に回すと壊れたデータを暗号文に
してしまい誰も中身を確かめられなくなる。突き合わせ（`assertRemoteNotAhead()`）は
暗号化しても無改造で効く ── 読むのは封筒の外側の `updatedAt` で、GCM の認証タグの中を
復号する必要が無いため。

`publish()` は `{ commitUrl, conflictChecked }` を返す。`conflictChecked` が `false` なら
リモートの `updatedAt` が読めず**突き合わせを省いて公開している** — `publish-ui.js` が
その旨を画面に出す（唯一ガードが効いていない場面を黙って通さない）。

### トークンの作り方（設計書 §5.4）

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. Repository access: **このリポジトリ（`y-shinozaki/travel-plans`）だけ**
3. Permissions: **Contents = Read and write のみ**。他の権限は与えない
4. **有効期限を設定する**（旅行終了後まで）
5. ページの「公開用トークンを設定」→ 貼り付け → 保存

**トークンをコードにもリポジトリにも書かないこと。** コミットしない、ドキュメントに貼らない、
テストのフィクスチャにも入れない。保存先は入力した端末のブラウザの
`localStorage["tp:gh-token"]` だけで、**平文**で入る（`store.js` の `readText` / `writeText`
を使うのは JSON パス経由で断片がログへ出るのを断つためで、暗号化はしていない）。
共用端末では使い終わったら設定画面の「削除」で消すこと。漏れた疑いがあれば GitHub 側で失効させる。

画面はトークンを一切表示し直さない（入力欄は `type="password"`、保存後に必ず空にし、
状態は「設定済み／未設定」だけを出す）。この規約を破らないこと。

### 予定エディタ

- 入口は `event-editor.js`。カレンダー／地図の選択で読み取り専用の詳細、
  「この予定を編集」または「予定を編集」トグルでフォームに切り替わる
- **`validateEvent` と `formProblems` の関係** — `event-form.js` の `formProblems()` は
  検査規則を書き写さず、`validate.js` の `validateEvent()` を呼ぶ。足すのは
  **より厳しい側の**フォーム固有の規則だけ（タイトル必須、同じ日の中では終了が開始より後、
  URL は http/https）。逆向きの規則を足すと「フォームは通すが読み込みで弾かれる」値ができ、
  利用者から見ると「保存したら旅程が真っ白になり、画面から戻す手段が無い」状態になる。
  メッセージはキー名（`lat`、`endDay` …）を画面の項目名へ言い換えるだけで、
  言い換えるのは言葉であって規則ではない
- **保存は「併合」であって「置き換え」ではない** — フォームには `image` / `imagePos` /
  `icon` の入力欄が無い。`readEventForm()` の戻り値でそのまま置き換えると、タイトルを
  1 文字直しただけでこれらのキーが消える。3 つとも省略できる項目なので
  `validateEvents()` は通ってしまい、消えたことは画像が出なくなるまで誰も気付かない。
  既存イベントの保存は必ず `mergeEvent(original, input)` を通すこと
- **保存の直前に必ず配列全体を `validateEvents()` に通す**（`event-editor.js` の
  `applyChange()`）。`formProblems()` は 1 件しか見ないので id の重複を検出できず、
  渡された `dayCount` をそのまま信じる。`validateEvents()` は `data.days` を自分で数えるため、
  ここが最後の砦になる
- `alert()` / `confirm()` は使わない。削除も取り込みも**1 度目で身構え、2 度目で実行**する
  ボタンで確認を取る

## Content-Security-Policy

3 ページすべての `<head>` に `<meta http-equiv="Content-Security-Policy">` を置いている
（内容は 3 ページで同一）。要点:

- **`script-src 'self'`** — `'unsafe-inline'` を入れていないので、インライン `<script>` も
  `javascript:` URL も実行されない。**インライン script を書かないこと**
  （`packing.html` のエントリポイントを `stub-page.js` に出したのはこのため）
- `connect-src 'self' https://api.github.com` — 公開フローが叩く先だけを許可
- `style-src` に `'unsafe-inline'` が要る（Leaflet と自前コードが `style` 属性を使うため）。
  狙いはスクリプト実行の遮断であって、スタイルではない
- `img-src` が `https:` のワイルドカードなのは、`events.json` と `menu.js` が
  複数の外部ホストから画像を直リンクしているため（設計書 §13 の負債）

`tests/csp.test.js` の 6 件が機械的に検査している。3 ページすべてを見るのが
「CSP がある」「`script-src` が `'self'` のみ」「インライン script が 1 つも無い」
「`on*` 属性が 1 つも無い」「`connect-src` に GitHub API がある」の 5 件で、
6 件目（`img-src` に地図タイル、`font-src` にフォント）だけは `schedule.html` しか
見ていない（設計書 §13 のテストの穴）。

## デザインシステム

すべての色・余白・角丸・モーションの値は `assets/css/tokens.css` の CSS カスタムプロパティに定義する。
**ハードコードされた 16 進数値をコード中に書かないこと。** 色を変える／確認する手順は後述の
「カラーを変更」を参照。パレットの出典と設計意図は `DESIGN.md` を参照。

## よく使う開発タスク

### 新しいイベントを追加

**画面から追加する** — 旅程ページの「予定を追加」。下書きは `localStorage` に入り、
「公開」を押すとリポジトリの `events.json`（暗号化した封筒 JSON）にコミットされる
（前述「保存と公開」）。

**`events.json` はリポジトリ上では暗号文なので、テキストエディタで開いて手編集することは
できない。** 初期データの投入やまとめての書き換えが必要な場合も、画面からの操作
（追加・編集・削除・公開）を通すこと。手編集を復活させるなら、暗号化・`updatedAt` の
更新・検証をエディタの外で再現する手段が要る。

### 新しいカテゴリを追加

**触るファイルは 3 つある。**「カテゴリの知識は `categories.js` だけ」ではない
（色の実体は CSS 側にあり、JS は名前で参照しているだけ）。

1. `assets/js/categories.js` の `CAT_META` に `cat-xxx`（ラベルと既定アイコン）を足す
2. `assets/css/tokens.css` に `--c-xxx` / `--c-xxx-bg` / `--c-xxx-tx` の 3 値を足す
3. `assets/css/calendar.css` に `.cat-xxx { --bar / --bg / --tx }` のブロックを足す

1 だけで 2 を忘れると `accentColor()` が例外になり、3 を忘れるとイベントブロックも
終日ピルも未定義のカスタムプロパティを参照して無色になる（JS 側は何も気付かない）。

`node --test` がこの 3 点セットを機械的に検査する。`tests/tokens.test.js` は
カテゴリ一覧を `CAT_META` から導いているので、**テストにカテゴリ名を書き写さないこと**
（写すと 1 だけ足して CSS を忘れた状態が素通りする）。
新しいカテゴリは `tests/categories.test.js` の `CATEGORIES`（Phase A の想定一覧）にも足す。

`tokens.test.js` の色リテラル検査（次項）は対象ファイルをハードコードしたリストで持っている。
Phase B2 で `packing.css` をそのリストへ足した。**リストがハードコードのままなので、
次に新しい CSS ファイルを足すときも同じ手順（このリストへの追加）が要る** ──
忘れても検査は何も言わずに素通りする（設計書 §13「小さいもの」）。

### データの検査（`assets/js/validate.js`）

`sync.load()` は、リモートから取った `events.json` も `localStorage` の下書きも、
画面に出す前に `validateEvents(data)` へ通す。ここを通過したコードは
「`days` の添字は有効」「座標は有限」を前提にしてよい。

`validateEvent(ev, dayCount, seenIds, where)`（イベント 1 件）も公開している。
**イベント 1 件に対する規則の置き場所はここ 1 か所だけ**で、編集フォームの
`formProblems()` もこれを呼ぶ（前述「予定エディタ」を参照）。

検査するのは、破ると**静かに壊れる**前提:

- `days` / `events` が配列で、`days` が空でないこと
- `startDay` / `endDay` が `[0, days.length)` の整数で、`endDay >= startDay` であること
  （範囲外だと `expandEvents` が 0 セグメントを返し、イベントがカレンダーから黙って消える）
- `cat` が `CAT_META` にあること
- 終日でないイベントの `start` / `end` が有限で 0〜24 に収まること
  （**`start > end` は日をまたぐイベントの正しい形。入れ替えて「直さない」こと**）
- `lat` / `lng` が「両方 null」か「両方が有限の数値」であること
  （片方だけだと「座標なし」と区別が付かず、`NaN` は `!= null` をすり抜けて Leaflet に届く）
- `id` が空でない一意の文字列であること

不備は 1 件目で止めず全部集め、どのイベントの何が悪いかを名指しして
`EventDataError` で投げる。画面には「再読み込みでは直らない」旨とともに一覧が出る。

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

**Leaflet を CDN からセルフホストへ変更した理由**: このリポジトリへの書き込み権限を持つ
GitHub トークンをブラウザに保存している（Phase B1 で実装済み）。CDN 経由のスクリプトが差し替えられた場合、
そのトークンを盗み出されたり、リポジトリへ任意の内容を push されたりする恐れがあるため、
サードパーティの JS を一切 CDN から読み込まない方針にした。トークンの具体的な保存先・扱いは
`docs/superpowers/specs/2026-08-09-travel-plans-redesign-design.md` §5.4・§5.5 を参照
（この CLAUDE.md では詳細を重複させない — 設計変更のたびにここが古くなるのを避けるため）。
Leaflet を更新する際は `assets/vendor/leaflet/` 配下のファイルを手動で差し替える。

アイコンは Material Symbols フォントではなく、`assets/js/icons.js` が注入するインライン SVG スプライト
（`<svg class="ico"><use href="#i-xxx"/></svg>`）を使う。

## テスト

```bash
node --test
```

依存ゼロ、ビルド不要。`tests/` 配下は純粋関数・静的な検証を対象にしている
（`package.json` は `"type": "module"` を宣言するためだけに存在する）。

- `time.test.js` / `events.test.js` / `lanes.test.js` / `icons.test.js` / `categories.test.js`
- `calendar.test.js` — `blockLayout()` の配置計算（上端・下端の切り落とし、22px の下限、
  列の高さによるクランプ、時刻ラベルを出す 36px の境界）
- `validate.test.js` — `validateEvents()`。不備が例外になり、かつイベントを名指しすること
- `countdown.test.js` — 出発カウントダウンの日付計算と境界
- `data.test.js` — パイプライン（検査 → `expandEvents` → `assignLanes`）を
  `tests/fixtures/itinerary.js` の合成データに通す（Phase B4 で `events.json` が
  暗号文になり、実データを直接読んで検査できなくなったため）。件数・セグメント数・
  地点数の実測値はこの合成データに対する固定値で、フィクスチャを変えると更新が要る。
  リポジトリの `events.json` が封筒の形をしていること（中身までは見られない）も
  同じファイルで検査する
- `renderers.test.js` — エスケープ、URL スキームの許可リスト、カテゴリ絞り込み、`renderNav`
- `tokens.test.js` — 色のコントラストと、下記の CSS 側の約束

Phase B1 で追加したもの:

- `csp.test.js` — 3 ページの CSP（前述「Content-Security-Policy」）
- `store.test.js` — 読みは既定値へ落とし、書きは必ず `StoreWriteError` で知らせること
- `base64.test.js` — 日本語・絵文字・長い入力の往復
- `sync-decide.test.js` — `decideSync()` の全分岐
- `github.test.js` — Contents API の応答（404 / 409 / 401 / 403 / 通信断・想定外の本文）
- `sync.test.js` — `load` / `saveLocal` / `adoptRemote` / `publish` /
  `hasUnpublishedChanges`、および `token.js`。`fetchImpl`・`store`・`now` を
  差し替えて通信なしで回す
- `event-form.test.js` — フォームの組み立てと読み取りの往復、`formProblems()` が
  `validateEvent()` を通していること
- `event-editor.test.js` — 採番・併合（`image` を落とさない）・配列の差し替え・配線
- `publish-ui.test.js` — トークンが DOM に出ないこと、公開ボタンの出し分け、
  失敗の見せ分け、2 度押しの確認

Phase B4 で追加したもの:

- `crypto.test.js` — 封筒 codec（`createCodec()`）の暗号化・復号の往復（日本語・絵文字を含む）、
  `isEnvelope()`、鍵違い（`wrong-key`）と中身の破損（`corrupt`）の見分け
- `auth.test.js` — 鍵素材の保存・読み出し・`kdfMatches()`、`hasKey()` と `loadCodec()` が
  一致しない壊れ方（形は正しいが base64 として壊れた鍵）
- `auth-form.test.js` — 合言葉フォームの配線、`decode()` による確認を省いていないこと、
  形は正しいが中身が違う鍵でも「入れ直す」導線が常に出ること、合言葉を DOM に残さないこと
- `load-error.test.js` — `classifyLoadError()` が失敗の種類（データ不備・鍵違い・破損・
  取得失敗）ごとに違う文言を出すこと

Phase B2 で追加したもの:

- `data-error.js` に専用のテストファイルは無い。`DataError` を継承していることは
  `validate.test.js`（`EventDataError`）と `packing-validate.test.js`（`PackingDataError`）が
  それぞれ `instanceof DataError` で確認する
- `packing-validate.test.js` — `validatePacking()`。持ち物データの不備を 1 件目で
  止めずに全部集め、どの項目の何が悪いか名指しすること
- `packing-data.test.js` — `packing-data.js` の純粋関数（追加・移動・区分をまたぐ移動・
  併合）。`event-editor.js` と同じ方針で、失われ方が静かな操作を 1 つずつ確認する
- `packing-render.test.js` — 描画される文字列、`data-focus-key` / `data-item-id` /
  `data-group-id` の付与、`editing` による表示の分岐
- `packing-drag.test.js` — `rebuildFromOrder()`。order に無い区分・項目を
  黙って落とさないこと
- `tests/fixtures/packing.js` — 持ち物側のテストが使う合成データ
  （`tests/fixtures/itinerary.js` の持ち物版）
- `load-error.test.js` は `classifyLoadError({ noun, path })` の一般形（既定は旅程、
  持ち物向けに差し替えた場合の両方）を検査するようになった
- `publish-ui.test.js` は `content`（`validate` / `noun` の組）が必須であること、
  `MESSAGES` が旅程固定ではなく `messagesFor(noun)` から作られることを検査する
- `sync.test.js` は `noun` を含む 6 つの注入口を、注入した `draftKey` で実際に
  `saveLocal()` を回すところまで検査する

`tokens.test.js` は色そのものに加えて次の約束も機械的に守らせている:

- `--hour-h`（tokens.css）と `HOUR_H`（calendar.js）が同じ値であること
- `base.css` / `controls.css` / `calendar.css` / `packing.css` に色リテラルを書かないこと
  （半透明が必要なら `rgb(var(--ink-rgb) / 0.14)` のようにチャンネルトークンを使う）
- `CAT_META` の各カテゴリに `tokens.css` の 3 値と `calendar.css` の `.cat-xxx` が揃っていること
  （「新しいカテゴリを追加」参照。カテゴリ一覧は `CAT_META` から導いている）

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
  Phase B1 以降、ブラウザで入力した文字列を、リポジトリ書き込み権限を持つトークンを
  抱えたページ自身が描画している。この規約は必須（CSP の `script-src 'self'` は
  二重の防御であって、これの代わりにはならない）
- **`href` に載せる URL は `escapeHtml()` では守れない。** `escapeHtml()` が変換するのは
  `& < > " '` の 5 文字だけで、`javascript:…` にはそのどれも含まれない。
  URL は必ず `dom.js` の `safeHttpUrl()`（http / https の許可リスト）を通し、
  弾かれた値はリンクにしないこと
- **エラーは必ず画面かコンソールに出す。** `alert()` / `confirm()` / `prompt()` は使わない。
  各ページのエントリポイント（`menu.js` / `schedule.js`）は本体を `try` / `catch` / `finally`
  で囲み、失敗しても `initReveal()` は必ず走らせる（`.reveal` は `opacity: 0` で待機しているため、
  飛ばすとページが真っ白になる）。初回描画のあとの再描画（`schedule.js` の `safeDraw()`）も
  同様に守ること
- **`localStorage` のキー名を書き写さないこと。** `tp:events` / `tp:events-base` は
  `sync.js`（の既定 `DEFAULT_CONFIG`）、`tp:packing` / `tp:packing-base` は `packing.js` が
  `createSync()` に渡す `config`、`tp:gh-token` は `token.js`、`tp:key` は `auth.js` だけが
  知っている。別のファイルに書き写すと、キーを変えたときに片方だけが古い名前を読み、
  「変更が無い」と黙って答え続ける
- **トークンも合言葉（から導いた鍵）も画面にも例外文にも出さないこと。** `store.read` は
  壊れた値を `JSON.parse` に掛けるので、`SyntaxError` の文言に中身の先頭が埋め込まれて
  `console.warn` に出る。トークンと鍵素材は `readText` / `writeText`（JSON を通さない）で扱う
- Leaflet MarkerCluster は未実装。イベント密度が大幅に増加した場合に追加検討
- Dancing Script（旧デザインの筆記体タイトル）は Aman 由来のデザインへの刷新に伴い廃止した。
  現在の見出しフォントは `--serif`（Newsreader / Noto Serif JP）
- 残っている課題（時計ずれによる上書きの残存リスクなど）は設計書 §13 にまとめてある。
  保存・公開まわりに手を入れる前に読むこと
