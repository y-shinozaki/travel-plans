/**
 * 合言葉の入力欄（index.html の入口）。
 *
 * menu.js はここに要素を渡すだけで、判断（鍵を保存してよいか・どの文言を出すか）は
 * 一切持たない。publish-ui.js と同じ理由でモジュールを分けてある ── menu.js は
 * モジュール冒頭で document を触るため node --test から import できず、
 * ここに切り出すことで decode() の確かめのような核心のロジックを機械的に検査できる。
 *
 * 守っていること（token.js・publish-ui.js と同じ規約）:
 *
 * - 合言葉を画面にも例外文にも出し直さない。入力欄は type="password"、
 *   送信の成否に関わらず必ず空にする。状態は「設定済み／未設定」だけ
 * - alert() / confirm() は使わない。鍵の作り直しは 1 度目で身構え、
 *   2 度目で確定する（publish-ui.js のトークン削除ボタンと同じ形）
 *
 * 設計書 §6.1・§9 に対応。
 */

import { el } from "./dom.js";
import { hasKey, unlock, clearKey } from "./auth.js";
import { isEnvelope, DecryptError } from "./crypto.js";
import { StoreWriteError } from "./store.js";

export const MESSAGES = {
  needPassphrase: "合言葉を入力してください。",
  working: "鍵を作っています（数秒かかります）…",
  wrongPassphrase: "合言葉が違います。",
  // reason が "malformed" のとき用。load-error.js の corrupt 文言と同じ趣旨
  // （合言葉の入れ直しでは直らない・公開し直しが要る）だが、ここは
  // まだページの入口なので「index.html に戻って」を含めない
  corruptData:
    "旅程データを復号できましたが、中身が壊れています。合言葉の入れ直しでは直りません。" +
    "旅程を持っている端末から公開し直してください。",
  fetchFailed: "最新の旅程データを取得できませんでした。通信を確認してもう一度お試しください。",
  keyFailed: "鍵を作れませんでした。もう一度お試しください。",
  // store.writeText が StoreWriteError を投げた場合専用。keyFailed と違い
  // 「もう一度」を含めない ── プライベートブラウズや Cookie ブロックが原因なら
  // 何度やり直しても保存できず、再試行を勧めるのは利用者を無意味な繰り返しへ
  // 誘導するだけ（B4 最終レビュー Important 1）
  cannotPersist:
    "この端末では鍵を保存できません（プライベートブラウズや Cookie のブロックが" +
    "有効かもしれません）。通常のブラウザで開いてください。",
  stateSet: "状態: 設定済み",
  stateUnset: "状態: 未設定",
  reenter: "合言葉を入れ直す",
  reenterArmed: "もう一度で入れ直す（今の鍵を消します）",
};

/**
 * @param {object} deps
 * @param {{state:HTMLElement, actions:HTMLElement, form:HTMLElement, input:HTMLElement,
 *          status:HTMLElement, submit:HTMLElement}} deps.els
 * @param {object} deps.store store.js の createStore
 * @param {string} deps.path 旅程データの取得元（sync.js の DEFAULT_CONFIG.path）
 * @param {typeof fetch} [deps.fetchImpl] 通信なしでテストするための差し替え口
 * @param {() => void} [deps.reload] 成功後にページを再読み込みする関数。
 *   テストでは location に触れないよう差し替える
 */
export function createAuthForm({ els, store, path, fetchImpl = fetch, reload = () => location.reload() }) {
  /**
   * 状態表示と「入れ直す」ボタン。**hasKey(store) に依存して組み立てを
   * 諦めないこと** ── 直前のレビューで見つかった穴がこれで、鍵が
   * 「形としては正しいが中身（合言葉）が間違っている」状態のまま保存されると、
   * 唯一の入れ直す場所がここなのに、hasKey が true だからと出さずに終わっていた。
   * ここでは常に呼び、hasKey の値によって中身を出し分けるだけにする。
   */
  function renderState() {
    const withKey = hasKey(store);
    els.state.textContent = withKey ? MESSAGES.stateSet : MESSAGES.stateUnset;
    els.actions.replaceChildren();
    if (!withKey) return;
    els.actions.appendChild(buildReenterButton());
  }

  /** 1 度目で身構え、2 度目で鍵を消して入力欄を開く。confirm() は使わない。 */
  function buildReenterButton() {
    const button = el("button", "btn", MESSAGES.reenter);
    button.type = "button";
    let armed = false;
    button.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        button.className = "btn btn--danger";
        button.textContent = MESSAGES.reenterArmed;
        return;
      }
      clearKey(store);
      openForm();
    });
    return button;
  }

  function openForm() {
    els.form.hidden = false;
    els.status.textContent = "";
    renderState();
  }

  function closeForm() {
    els.form.hidden = true;
    els.status.textContent = "";
    renderState();
  }

  /**
   * 旅程データを取ってくる。「取れなかった」（通信断・非 2xx・JSON として読めない）
   * ときは呼び出し側で止める合図として null を返す。ここでは鍵をまだ何も作らない
   * ── unlock() より前でここが止まるようにするのが Important 1(b) の直し方。
   *
   * response.ok を見ないと、404 で HTML を返すサーバー（GitHub Pages はそう）の
   * 場合は .json() が例外になって助かるが、非 2xx で JSON のエラー本文を返す
   * サーバーだとそれをファイル本文として読んでしまい、isEnvelope が false になって
   * 「平文だった」の枝へ静かに入る（Minor 5、Important 1(c) と同じ穴）。
   */
  async function fetchRemoteBody() {
    let response;
    try {
      response = await fetchImpl(path, { cache: "no-store" });
    } catch (error) {
      console.warn("auth-form: 旅程データを取得できませんでした", error);
      return null;
    }
    if (!response.ok) {
      console.warn(`auth-form: 旅程データの取得に失敗しました（HTTP ${response.status}）`);
      return null;
    }
    try {
      return await response.json();
    } catch (error) {
      console.warn("auth-form: 旅程データを JSON として読めませんでした", error);
      return null;
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const passphrase = els.input.value;
    if (!passphrase) {
      els.status.textContent = MESSAGES.needPassphrase;
      return;
    }

    els.submit.disabled = true;
    els.status.textContent = MESSAGES.working;
    try {
      const body = await fetchRemoteBody();
      if (body === null) {
        // 取れなかった。検証されないまま鍵を保存しない ── 新しいソルトで
        // 鍵を作ってしまうと、暗号化済みのデータの上に無関係な鍵ができ、
        // 入力欄も無いまま（このタスクの直前まではそうだった）ロックアウトする
        els.status.textContent = MESSAGES.fetchFailed;
        return;
      }

      // 取れた本文が平文（ct が無い）なら、それは移行当日の 1 回だけ通る経路。
      // ここを塞ぐと最初の合言葉設定ができなくなるので、fetch 失敗と平文は
      // 必ず区別する
      const encrypted = isEnvelope(body);
      const codec = await unlock(store, passphrase, encrypted ? body.kdf : null);

      // 合言葉が正しいかは、ここで実際に復号して確かめる。**この確認を省かないこと。**
      //
      // ソルトは 3 つの JSON で共有する（設計書 §6.3）ので、合言葉を打ち間違えても
      // 封筒の kdf は一致する（unlock() が body.kdf をそのまま使うため、kdf の
      // 不一致＝wrong-key はこの経路では実質起きない）。実際に打ち間違いを
      // 捕まえているのは GCM の認証タグ検証の失敗（reason: "corrupt"）のほうで、
      // それは crypto.js の kdf 比較では見分けられない。
      if (encrypted) {
        try {
          await codec.decode(body);
        } catch (error) {
          clearKey(store);
          // reason: "malformed"（base64 が読めない・復号後が JSON でない）は
          // 合言葉の問題ではない。「合言葉が違います」を出すと、直しようのない
          // ものを直そうとして延々と打ち直させることになる（Minor）
          els.status.textContent =
            error instanceof DecryptError && error.reason === "malformed"
              ? MESSAGES.corruptData
              : MESSAGES.wrongPassphrase;
          return;
        }
      }

      closeForm();
      reload();
    } catch (error) {
      console.error("auth-form: 鍵を作れませんでした", error);
      clearKey(store);
      // StoreWriteError は「保存領域に書けない」という別の失敗で、何度やり直しても
      // 直らない。keyFailed の「もう一度お試しください」を出すと、保存領域に書けない
      // 端末（プライベートブラウズ、Cookie ブロックなど）を無意味な再試行へ誘導し、
      // B4 以前は読めていたはずのページから締め出してしまう
      els.status.textContent = error instanceof StoreWriteError ? MESSAGES.cannotPersist : MESSAGES.keyFailed;
    } finally {
      // 合言葉を DOM に残さない。成功・失敗を問わず必ず空にする
      els.input.value = "";
      els.submit.disabled = false;
    }
  }

  els.form.addEventListener("submit", (event) => {
    handleSubmit(event).catch((error) => console.error("auth-form: 予期しない失敗", error));
  });

  els.form.hidden = hasKey(store);
  renderState();

  return { renderState };
}
