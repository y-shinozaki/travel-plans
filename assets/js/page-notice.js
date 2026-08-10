/**
 * ページが「失敗した」と伝えるための共通部品。
 *
 * schedule.js と packing.js が setNotice / setStampNotice / safeDraw を
 * 全文コピーで持っていた（設計書 §13）。違っていたのはアンカー要素と、
 * console へ添える情報だけで、**画面に出す文言は完全に一致していた** ──
 * そこが割れると、同じ失敗を片方のページだけ違う言葉で説明することになる。
 *
 * DOM は触るが document をモジュール冒頭で参照しないので、createElement だけを
 * 備えたスタブがあれば node --test から呼べる（tests/page-notice.test.js）。
 */

/**
 * アンカー要素の直前に差し込む、一行の通知を 2 つ作る。
 *
 * **2 つは必ず別の要素を使う。** safeDraw は再描画に成功するたびに
 * setNotice(null) を呼ぶので、同じ要素を共有すると、編集モードの切り替えや
 * 表示時間帯の変更といった操作で setStampNotice の警告が黙って消える。
 * 封筒の外側の updatedAt の食い違い（setStampNotice が出すもの）は操作の
 * 成否とは無関係な事実で、次に公開して外側が上書きされるまで出続けるべきもの。
 *
 * アンカー本体は潰さないので、再描画に失敗しても直前まで見えていた内容は残る。
 *
 * @param {Element} anchor この要素の直前に差し込む（カレンダー本体・表本体）
 * @returns {{setNotice: (m: string|null) => void, setStampNotice: (m: string|null) => void}}
 */
export function createNotices(anchor) {
  const make = (role) => {
    let node = null;
    return (message) => {
      if (!message && !node) return;
      if (!node) {
        node = document.createElement("p");
        node.className = "ferror";
        node.setAttribute("role", role);
        anchor.parentNode.insertBefore(node, anchor);
      }
      node.textContent = message ?? "";
      node.hidden = !message;
    };
  };
  // alert は操作の失敗（今すぐ読ませたい）、status は事実の通知（割り込まない）
  return { setNotice: make("alert"), setStampNotice: make("status") };
}

/**
 * 再描画の失敗を伝える文言。**読み込み失敗（classifyLoadError）とは別の言葉にする** ──
 * データは取れているのに操作に反応しなかった、という別の状況なので、
 * 「再読み込み」を勧めるのは誤り。
 */
export const REDRAW_FAILED = (context) =>
  `表示の更新に失敗しました（${context}）。` +
  "直前の表示のまま止まっています。原因はブラウザのコンソールを確認してください。";

/**
 * 初回描画のあとの再描画を、即時（safeDraw）と予約（scheduleDraw）の 2 つの口で包む。
 *
 * main() の try/catch が守るのは最初の draw() だけで、セレクトの change や
 * ボタンの click から呼ばれる draw() は素通しになる。そこで落ちると画面は
 * 前回の描画を半分だけ残した状態で止まり、利用者には何も伝わらない。
 *
 * **なぜ予約が要るか（設計書 §13。node --test では捕まえられない不具合）**
 *
 * 入力欄の change は blur の最中に発火する ── つまり、利用者がボタンを押した
 * mousedown の処理の**途中**で起きる。そこで表を replaceChildren すると:
 *
 * 1. 押しかけていたボタンが mouseup より前に文書から消え、**click が発火しない**。
 *    名前を打ってすぐ「追加」を押しても増えず、画面には何も出ない
 *    （2 度押せば動くので、かえって原因が分かりにくい）
 * 2. ブラウザが移そうとしていたフォーカス先も消えるので document.activeElement は
 *    <body> になり、描画側がキーを拾えずフォーカスが落ちたままになる
 *
 * 描画を 1 tick 送れば両方が消える。**microtask では足りない** ──
 * blur → change は mousedown の既定動作の中なので、queueMicrotask は
 * mouseup より前に走ってしまう。
 *
 * **予約の取り消しは safeDraw の内側に閉じ込めてある。** 呼ぶ側が順序を
 * 気にしなくてよくするため ── 取り消さずに即時描画すると、そのあとに予約分が
 * 走り、成功時の setNotice(null) が直前に出した文言を消す。
 *
 * 予約が要らないページ（schedule.html）は safeDraw だけを取り出して使う。
 *
 * @param {object} args
 * @param {string} args.page console に出す接頭辞（"schedule" / "packing" / "souvenirs"）
 * @param {Function} args.draw 描画本体。第 1 引数にフォーカスキーの指定が渡る
 * @param {Function} args.setNotice createNotices() の setNotice
 * @param {() => object} [args.details] 失敗時に console へ添える状態
 * @returns {{safeDraw: Function, scheduleDraw: Function}}
 */
export function createDrawLoop({ page, draw, setNotice, details }) {
  let timer = null;
  let pendingContext = "";
  let pendingOverride = null;

  function cancelPending() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    pendingOverride = null;
  }

  /** 今すぐ描く。予約があれば捨てる。 */
  function safeDraw(context, focusKeyOverride) {
    cancelPending();
    try {
      draw(focusKeyOverride);
      setNotice(null);
    } catch (error) {
      // details が無いときに undefined を足さない（テストが引数の本数を見ている）
      const extra = details ? [details()] : [];
      console.error(`${page}: 再描画に失敗しました（${context}）`, ...extra, error);
      setNotice(REDRAW_FAILED(context));
    }
  }

  /**
   * 1 tick 送ってから描く。連続した変更（改名の直後に追加、など）は
   * 1 回の描画にまとめる ── まとめないと、先に予約した描画が新しい
   * フォーカス指定を上書きしてしまう。
   */
  function scheduleDraw(context, focusKeyOverride) {
    pendingContext = context;
    // あとから来た指定を優先する。undefined で上書きして消さないこと
    if (focusKeyOverride) pendingOverride = focusKeyOverride;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      const override = pendingOverride;
      pendingOverride = null;
      safeDraw(pendingContext, override);
    }, 0);
  }

  return { safeDraw, scheduleDraw };
}
