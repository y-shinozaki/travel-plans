/**
 * 「データ内容の不備」の共通の基底。
 *
 * 旅程（EventDataError）と持ち物（PackingDataError）は別のファイル・別の規則だが、
 * 利用者から見た直し方は同じ ──「再読み込みでは直らない。中身を直してから読み込み直す」。
 * load-error.js がその 1 つの分類に落とせるよう、共通の親をここに置く。
 *
 * このファイルには基底クラスしか置かない。検証規則は各 validate 側にある
 * （validate.js が旅程、packing-validate.js が持ち物）。
 */
export class DataError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataError";
  }
}
