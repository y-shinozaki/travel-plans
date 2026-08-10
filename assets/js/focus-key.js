/**
 * 再描画のあとにフォーカスを戻すためのキーの書式。
 *
 * **組み立てる側と querySelector する側が、必ずこの関数を通ること。**
 * 書式を 2 か所に書くと、片方だけ変えても例外は出ず、フォーカスが静かに
 * <body> へ落ちるだけになる ── フォーカスを守るための仕掛けが、
 * 同じ壊れ方で無効になる（設計書 §13）。
 *
 * 位置ではなく id から作る。位置から作ると、並べ替えたその瞬間に
 * 「動いた」という事実そのものでキーが変わってしまう。
 */
const key = (kind) => (id, field) => `${kind}:${id}:${field}`;

/** 持ち物の項目。区分をまたいで一意な id を使う。 */
export const itemFocusKey = key("item");

/** 持ち物の区分。項目とは別の名前空間なので接頭辞で分ける。 */
export const groupFocusKey = key("group");

/** お土産の 1 行（Phase B5）。 */
export const souvenirFocusKey = key("sv");
