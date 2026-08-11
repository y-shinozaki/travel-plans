/**
 * 「素のオブジェクトか」の判定。
 *
 * 同じ 1 行が 5 か所に複製されていた（validate.js / sync.js /
 * packing-validate.js / souvenirs-validate.js と、event-form.js に
 * isEventObject という別名で 1 つ）。判定が割れても**例外は出ない** ──
 * 片方だけ配列を通すようになれば、そちらのデータだけが「オブジェクトとして
 * 妥当」と読まれ、あとの工程で静かに壊れる。設計書 §13。
 *
 * 依存を持たないのは、検証層（validate 系）と保存層（sync）の両方から
 * 呼ぶため。ここに何かを import すると、その何かが両方へ付いて回る。
 *
 * 配列を弾くのは、JSON では配列もオブジェクトだが、この 5 か所が
 * 期待しているのは必ず「キーを持つ入れ物」のほうだから。null を弾くのは
 * typeof null === "object" という JS の既知の穴。
 */
export const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
