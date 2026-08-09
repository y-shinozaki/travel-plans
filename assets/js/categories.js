/**
 * カテゴリの定義を 1 か所にまとめる。
 *
 * ラベル・既定アイコン・アクセント色トークン名は、どれも「cat-xxx という
 * カテゴリが何であるか」を表す同じ知識なので、同じ表に持たせる。
 * 以前は CAT_META が calendar.js、CATEGORY_ICON が icons.js に分かれており、
 * カテゴリを 1 つ増やすのに 2 ファイル触る必要があった。
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

/** イベント個別指定を優先し、無ければカテゴリ既定のアイコン id を返す。 */
export function iconOf(ev) {
  return ev.icon || catMeta(ev.cat).icon;
}

/** cat-xxx → tokens.css のアクセント色カスタムプロパティ名。 */
export function accentToken(cat) {
  catMeta(cat);
  return `--c-${cat.slice("cat-".length)}`;
}

/** カテゴリのアクセント色を tokens.css から読む。色をここに書かない。 */
export function accentColor(cat, root = document.documentElement) {
  return getComputedStyle(root).getPropertyValue(accentToken(cat)).trim();
}
