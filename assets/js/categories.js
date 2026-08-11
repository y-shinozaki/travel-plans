/**
 * カテゴリの「JS 側の」定義をまとめる。
 *
 * ラベル・既定アイコン・アクセント色トークン名は、どれも「cat-xxx という
 * カテゴリが何であるか」を表す同じ知識なので、同じ表に持たせる。
 * 以前は CAT_META が calendar.js、CATEGORY_ICON が icons.js に分かれており、
 * カテゴリを 1 つ増やすのに JS を 2 ファイル触る必要があった。
 *
 * icons.js はスプライト（symbol の実体と id の一覧）だけを扱う。
 * 「どのカテゴリにどのアイコンを割り当てるか」はスプライトの知識ではないため、
 * 旧 CATEGORY_ICON はここへ移し、CAT_META の icon フィールドに畳んだ
 * （同じ 5 つのキーを持つ表が 2 つ並ぶと、片方だけ更新される事故が起きる）。
 * 平坦な cat → icon の対応表を必要とする呼び出し側はもう無いので、
 * 別名は残していない。参照は iconOf(ev) か CAT_META[cat].icon を使う。
 *
 * カレンダーを持たないページ（Phase B の持ち物リストなど）からも
 * これらを使うため、描画側のモジュールには依存しない。
 *
 * ── カテゴリを 1 つ増やすときに触るファイル（3 つ） ────────────────
 *
 * 「カテゴリの知識はこのファイルだけ」ではない。色の実体は CSS 側にあり、
 * JS からは名前でしか参照していないので、次の 3 つを必ず揃えること:
 *
 *   1. このファイルの CAT_META に cat-xxx を足す（ラベルと既定アイコン）
 *   2. tokens.css に --c-xxx / --c-xxx-bg / --c-xxx-tx の 3 値を足す
 *   3. calendar.css に .cat-xxx { --bar / --bg / --tx } のブロックを足す
 *
 * 1 だけ足して 2 を忘れると accentColor が落ち、3 を忘れるとカレンダーの
 * ブロックが無色になる。3 つが揃っているかは tokens.test.js が
 * CAT_META を起点に機械的に検査する（テストにカテゴリ名を書き写さないこと）。
 */

export const CAT_META = {
  "cat-move": { label: "移動", icon: "i-flight" },
  "cat-sight": { label: "観光", icon: "i-camera" },
  "cat-food": { label: "食事", icon: "i-food" },
  "cat-hotel": { label: "宿泊", icon: "i-hotel" },
  "cat-shop": { label: "買物", icon: "i-shop" },
};

/**
 * 未知のカテゴリはここで必ず例外にする。
 *
 * 以前は同じ「未知の cat」が 3 通りに壊れていた:
 * icon() は Error を投げ、CAT_META[cat].label は素の TypeError、
 * accentColor は空文字を返して無色のピンを黙って描いていた。
 * データの不備は 3 通りではなく 1 通りに、しかも必ず表に出す。
 */
export function catMeta(cat) {
  const meta = CAT_META[cat];
  if (!meta) {
    throw new Error(`categories: 未知のカテゴリです: ${cat}`);
  }
  return meta;
}

/**
 * イベント個別指定を優先し、無ければカテゴリ既定のアイコン id を返す。
 *
 * ev.icon があっても cat は必ず検証する。以前は `ev.icon || catMeta(ev.cat).icon`
 * と書いていたため、個別アイコンを持つイベントだけ未知の cat が素通りし、
 * **カレンダーには出るが地図と詳細シートでは例外**という不揃いな壊れ方をした
 * （設計書 §13）。読み込み時の validateEvents が cat を見るので events.json
 * 経由では到達しないが、検査を経ない描画経路を足した瞬間に復活する。
 */
export function iconOf(ev) {
  const fallback = catMeta(ev.cat).icon;
  return ev.icon || fallback;
}

/**
 * CAT_META の -bg / -tx は「JS からは読まない」。
 * ティント地と文字色は calendar.css の .cat-xxx が --bg / --tx として供給し、
 * 各コンポーネントの CSS がそこから受け取る。JS が触るのはアクセント色だけで、
 * それも地図ピンの塗り（Leaflet の divIcon は CSS クラスだけでは色を渡せない）
 * という 1 か所のためにある。
 */

/** cat-xxx → tokens.css のアクセント色カスタムプロパティ名。 */
export function accentToken(cat) {
  catMeta(cat);
  return `--c-${cat.slice("cat-".length)}`;
}

/**
 * カテゴリのアクセント色を tokens.css から読む。色をここに書かない。
 *
 * 空文字が返るのは「そのトークンが存在しない」ときだけ。catMeta が未知の
 * カテゴリを弾いた先で、既知のカテゴリなのにトークン名が改名・削除されている、
 * という状態を意味する。そのまま返すと style="background:" になり、
 * 地図に透明なピンが黙って並ぶ ── catMeta を入れて潰したはずの壊れ方が
 * 1 段下で再発する。ここでも例外にして、必ず表に出す。
 */
export function accentColor(cat, root = document.documentElement) {
  const value = getComputedStyle(root).getPropertyValue(accentToken(cat)).trim();
  if (!value) {
    throw new Error(
      `categories: ${cat} のアクセント色トークン ${accentToken(cat)} が` +
        "解決できません（tokens.css に定義がありません）"
    );
  }
  return value;
}
