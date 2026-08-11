/**
 * 公開の導線。トークンの設定、公開ボタン、起動時の案内バー。
 *
 * sync.js が「どちらのデータを採るか」を決めるのに対し、ここは
 * 「その判断を人にどう見せ、何を選ばせるか」だけを持つ。判断そのものは
 * 一切やり直さない（同じ規則を 2 か所に書くと必ずずれる）。
 *
 * 守っていること:
 *
 * - 保存されているトークンを DOM へ書き戻さない。value にも、伏せ字にも、
 *   title 属性にも入れない。入力欄に残るのは「今この人が打った文字」だけで、
 *   保存した直後に消す
 * - 黙って取り込まない。取り込みは手元の未公開の変更を消すので、
 *   必ず明示の操作（しかも 2 度押し）を通す
 * - 直しようのない案内を出さない。保存領域に書けない端末では「取り込んで
 *   公開し直す」が成立しないので、その導線自体を出さない
 * - 値を innerHTML に流さない。文字は textContent、アイコンだけ定数の innerHTML
 *
 * 設計書 §5.4 に対応。
 */

import { el, safeHttpUrl } from "./dom.js";
import { icon } from "./icons.js";
import { hasToken, writeToken, clearToken } from "./token.js";
import { StoreWriteError } from "./store.js";
import { GitHubError } from "./github.js";
import { DataError } from "./data-error.js";

/**
 * 画面に出す文言。テストから参照できるよう外に出してある
 * （「この文字列が出ること」を実装の写経ではなく定数で確かめるため）。
 *
 * noun を取るのは、この UI が旅程と持ち物の両方から使われるため。
 * 「最新の旅程を確認できませんでした」を持ち物ページで出すと、
 * 利用者は開いてもいないページの話をされることになる。
 */
export function messagesFor(noun) {
  return {
    published: "公開しました。反映まで 1 分ほどかかります",
    /**
     * リモートの updatedAt が読めず、突き合わせを省いて公開したとき。
     * ガードが効いていない唯一の場面なので、成功の陰に隠さない。
     */
    conflictCheckSkipped:
      "リモートの更新時刻を確認できなかったため、確認せずに公開しました。" +
      "別の端末の未公開の変更を上書きした可能性があります",
    /**
     * PUT は通ったが、そのあとの控えを保存できなかったとき。
     * sync.publish() は PUT の成功後にしか store へ書かないので、
     * StoreWriteError が来た時点で公開自体は済んでいる。
     */
    publishedNotRecorded:
      "公開はできましたが、この端末に「どこまで公開したか」を記録できませんでした",
    /**
     * 保存領域に書けない端末。409 の定型文（取り込んでから公開し直す）は
     * この端末では成立しない ── 取り込みも同じ理由で失敗するため。
     */
    cannotPersist:
      "このブラウザは保存領域に書き込めないため、どの版を取り込んだかを記録できません。" +
      "取り込みを試しても同じ理由で失敗します。" +
      "プライベートブラウジングを解除する、保存領域の空きを作る、" +
      "または別の端末から公開してください",
    /**
     * 保存領域に書けない端末の 409。GitHubError の文言（取り込んでから公開し直す）は
     * ここでは出さない ── できない手順を案内することになる。
     * 生の文言は console に残す。
     */
    conflictUnverifiable:
      "公開できませんでした。リモートとの突き合わせができません" +
      "（この端末には「どこまで公開したか」の記録が残らないため）",
    offline: `最新の${noun}を確認できませんでした。手元のデータをそのまま表示しています`,
    remoteIsNewer:
      `別の端末で新しい${noun}が公開されています。` +
      "取り込むと、この端末の未公開の変更は失われます",
    keptLocal:
      "手元の変更を残しました。このまま公開すると" +
      "「リモートが更新されています」と表示されます（先に取り込みが必要です）",
    /**
     * 「表示も更新しました」とは言わない。描き直しに失敗した場合は
     * schedule.js の safeDraw が自分の文言で伝えるので、ここで先に
     * 「更新しました」と言うと画面上で 2 つの文言が矛盾する。
     */
    adopted: "リモートの内容を取り込みました",
    adoptFailed: "取り込めませんでした。",
    publishFailed: "公開できませんでした。",
    tokenSaved: "トークンを保存しました",
    tokenCleared: "トークンを削除しました",
    tokenEmpty: "トークンを入力してください",
    tokenHint:
      "GitHub の fine-grained personal access token（このリポジトリの Contents 書き込み権限）。" +
      "この端末のブラウザにだけ保存され、画面に表示し直すことはありません",
  };
}

/** 既存のテストと呼び出し側のための、旅程版の定数。 */
export const MESSAGES = messagesFor("旅程");

const PUBLISH_LABEL = "公開";
const PUBLISH_DIRTY_LABEL = "公開（未公開の変更あり）";
const PUBLISH_BUSY_LABEL = "公開中…";
const ADOPT_LABEL = "取り込む";
const ADOPT_ARMED_LABEL = "もう一度で取り込む（手元の変更は消えます）";
const TOKEN_DELETE_LABEL = "削除";
const TOKEN_DELETE_ARMED_LABEL = "もう一度で削除";

/**
 * この端末が保存領域に書けるかを実際に試す。
 *
 * 書けない端末では base（最後に揃えた時刻）を残せず、公開は毎回 409 になる。
 * その 409 に「取り込んでから公開し直してください」と添えるのは嘘で、
 * 取り込みも同じ理由で失敗する。案内を分けるためだけの判定なので、
 * 書けたら必ず消す（残すと 2 つ目のゴミキーになる）。
 */
const PROBE_KEY = "write-probe";

/**
 * @param {number} sizeHint 実際に書こうとしている文字数。
 *   **1 バイトで試すと、容量ぎりぎりの端末ではプローブだけ通って本番の
 *   書き込みが失敗する**（設計書 §13）。同じくらいの大きさで試せば、
 *   「書けるはずだったのに書けなかった」の幅が狭まる。
 *   0 以下や数値でない場合は、これまでどおり最小の書き込みで試す。
 */
function canPersist(store, sizeHint = 0) {
  const value = Number.isFinite(sizeHint) && sizeHint > 0 ? "x".repeat(sizeHint) : 1;
  try {
    store.write(PROBE_KEY, value);
    return true;
  } catch {
    return false;
  } finally {
    store.remove(PROBE_KEY);
  }
}

/** 保存しようとしている下書きのおおよその文字数。測れなければ 0（＝最小で試す）。 */
function sizeOf(data) {
  try {
    return JSON.stringify(data)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** 文字は textContent、アイコンだけ定数の innerHTML。値は絶対に混ぜない。 */
function labelledButton(cls, iconId, label) {
  const button = el("button", cls);
  button.type = "button";
  if (iconId) button.innerHTML = icon(iconId, "ico--sm");
  const span = el("span", null, label);
  button.appendChild(span);
  return { button, span };
}

/**
 * 1 度目で身構え、2 度目で実行するボタン。confirm() は使わない。
 * 取り込みも削除も、押した瞬間に取り返しがつかなくなる操作なので通す。
 */
function armedButton({ cls, armedCls, iconId, label, armedLabel, onConfirm }) {
  const { button, span } = labelledButton(cls, iconId, label);
  let armed = false;
  const disarm = () => {
    armed = false;
    button.className = cls;
    span.textContent = label;
  };
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.className = armedCls;
      span.textContent = armedLabel;
      return;
    }
    disarm();
    onConfirm();
  });
  // 離れたら構えを解く。トークン削除ボタンには updatePanel() という解除の経路が
  // あったが、取り込みボタンには無く、一度押すと「もう一度で取り込む（手元の
  // 変更は消えます）」の表示のまま戻らなかった（設計書 §13）。押しかけて
  // やめた人の画面に、押していない警告が残り続けるのは筋が悪い。
  // 2 度押しは同じボタンを続けて押すので、この解除で妨げられることはない
  button.addEventListener("blur", disarm);
  return { button, disarm };
}

/**
 * @param {object} deps
 * @param {{controls:HTMLElement, panel:HTMLElement, status:HTMLElement, bar:HTMLElement}} deps.els
 * @param {object} deps.store store.js の createStore
 * @param {object} deps.sync sync.js の createSync
 * @param {() => object} deps.getData 公開するデータ全体
 * @param {(data:object) => void} deps.onAdopt 取り込んだデータで画面を描き直す
 * @param {{validate:(data:object)=>void, noun:string}} deps.content
 *   **2 つで 1 組。既定値を持たせない。** 片方だけ渡せるようにすると、
 *   sync.js の注入口と同じ「部分的に直したときが一番危ない」状態になる ──
 *   validate だけ持ち物用に差し替えて noun を旅程のままにすると、
 *   持ち物ページが「最新の旅程を確認できませんでした」と言い出す。
 *   noun だけ差し替えて validate を忘れると、持ち物データが validateEvents に
 *   落ちて公開ボタンが必ず失敗する（こちらは静かではなく必ず投げるので、
 *   sync.js のデータ消失ほど危険ではないが、直せないことに変わりはない）。
 */
export function createPublishUI({ els, store, sync, getData, onAdopt, content }) {
  if (!content) {
    throw new Error("publish-ui: content（validate と noun）が必要です");
  }
  if (typeof content.validate !== "function") {
    throw new Error("publish-ui: content.validate に検証関数が必要です");
  }
  if (typeof content.noun !== "string" || !content.noun) {
    throw new Error("publish-ui: content.noun に空でない文字列が必要です");
  }
  // sync にも同じ noun が渡っている（createSync の config.noun）。両者を
  // 結びつける仕組みが無かったので、片方だけ書き換えると同期バーと
  // ステータスが違う名前を出すページができた ── どちらも例外を投げないので、
  // テストで拾えなければ誰も気付かない（設計書 §13）。ここで突き合わせる
  if (typeof sync?.noun === "string" && sync.noun !== content.noun) {
    throw new Error(
      `publish-ui: content.noun（${content.noun}）が sync の noun（${sync.noun}）と違います。` +
        "同じページの中で 2 つの名前が出ることになります"
    );
  }
  const { validate, noun } = content;
  const MSG = messagesFor(noun);

  /**
   * 未公開の変更があるか。持っているのは表示用の控えで、正は常にストア
   * （sync.hasUnpublishedChanges）。source から導かないこと ── use-local は
   * 「リモートが進んでいない」であって「編集がある」ではない。
   */
  let dirty = false;
  /**
   * 実行中の操作: null / "publish" / "adopt"。
   * 真偽値ではなく種類で持つ ── 取り込みの最中に公開ボタンが
   * 「公開中…」になっていると、何が走っているのかが嘘になる。
   */
  let busy = null;
  /** 画面上部のバーに今出ているボタン。busy の間だけ止めるために持つ。 */
  const barButtons = [];

  /* ── 状態表示（ツールバーの下） ─────────────────────── */

  /** 複数行を含む文言は改行を残す（validateEvents の指摘一覧など）。 */
  const line = (text, block = false) => el("p", block ? "ferror--block" : null, text);

  function setStatus(nodes, tone = "ok") {
    els.status.replaceChildren();
    els.status.className = `pubstat pubstat--${tone}`;
    for (const node of nodes) els.status.appendChild(node);
    els.status.hidden = nodes.length === 0;
  }

  const clearStatus = () => setStatus([]);

  /** コミットへのリンク。URL の出どころは GitHub だが、必ず許可リストを通す。 */
  function commitLink(commitUrl) {
    const href = safeHttpUrl(commitUrl);
    if (!href) return null;
    const link = el("a", "swipe", "コミットを見る");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  /* ── ツールバーのボタン ──────────────────────────────── */

  const publish = labelledButton("tbtn tbtn--pub", "i-check", PUBLISH_LABEL);
  const settings = labelledButton("tbtn", "i-lock", "トークン設定");

  /**
   * クリックから非同期処理を始める。投げっぱなしにすると、想定外の失敗が
   * unhandled rejection として消える。握り潰さず console に残す
   * （利用者向けの説明は doPublish / doAdopt が状態表示に出す）。
   */
  function launch(work, label) {
    work().catch((error) => console.error(label, error));
  }

  publish.button.addEventListener("click", () => {
    launch(doPublish, "publish-ui: 公開の処理が中断しました");
  });
  settings.button.addEventListener("click", () => setPanelOpen(els.panel.hidden));
  settings.button.setAttribute("aria-expanded", "false");
  settings.button.setAttribute("aria-controls", els.panel.id || "pub-panel");

  /**
   * トークンが無ければ公開ボタンを「隠す」のではなく置かない。
   * 押せないボタンが残っていると、何が足りないのかが伝わらない。
   */
  function renderControls() {
    const withToken = hasToken(store);
    settings.span.textContent = withToken ? "トークン設定" : "公開用トークンを設定";
    publish.span.textContent =
      busy === "publish" ? PUBLISH_BUSY_LABEL : dirty ? PUBLISH_DIRTY_LABEL : PUBLISH_LABEL;
    // 取り込みの最中も押させない（下書きが入れ替わる最中に公開したら
    // どちらを公開したのか誰にも分からない）が、文言は変えない
    publish.button.disabled = busy !== null;
    publish.button.className = dirty ? "tbtn tbtn--pub tbtn--dirty" : "tbtn tbtn--pub";
    els.controls.replaceChildren(
      ...(withToken ? [publish.button, settings.button] : [settings.button])
    );
  }

  function setDirty(next) {
    if (dirty === next) return;
    dirty = next;
    renderControls();
  }

  /**
   * 未公開の変更があるかをストアに聞き直す。判断を自前で持たないので、
   * 保存・公開・取り込みのどれで状態が動いても呼ぶだけでよい。
   */
  const refreshDirty = () => setDirty(sync.hasUnpublishedChanges());

  /**
   * 実行中の操作を切り替える。バーのボタンも一緒に止める ── 残しておくと
   * 「押したのに何も起きない」（doAdopt が busy で return する）になる。
   */
  function setBusy(kind) {
    busy = kind;
    for (const button of barButtons) button.disabled = kind !== null;
    renderControls();
  }

  /* ── トークン設定 ────────────────────────────────────── */

  const tokenInput = el("input", "inp");
  tokenInput.type = "password";
  tokenInput.id = "pub-token";
  // 保存済みの値を出さないので、ブラウザの自動補完にも出させない
  tokenInput.setAttribute("autocomplete", "off");
  tokenInput.setAttribute("spellcheck", "false");
  tokenInput.setAttribute("aria-describedby", "pub-token-hint");

  const tokenState = el("p", "pubpanel__state");
  const panelNote = el("p", "fhint");

  function setPanelNote(text) {
    panelNote.textContent = text ?? "";
    panelNote.hidden = !text;
  }

  function saveToken() {
    // 空で保存を押したときに既存のトークンを消さない。
    // writeToken は空文字を削除として扱うので、ここで止めないと
    // 「保存を押したら設定済みが消えた」が起こる
    if (!tokenInput.value.trim()) {
      setPanelNote(MSG.tokenEmpty);
      return;
    }
    try {
      writeToken(store, tokenInput.value);
    } catch (error) {
      // StoreWriteError の文言はキー名だけ。トークンは含まれない
      console.error("publish-ui: トークンを保存できませんでした", error);
      setPanelNote(`トークンを保存できませんでした。${error?.message ?? String(error)}`);
      return;
    } finally {
      // 成否に関わらず打った値を残さない
      tokenInput.value = "";
    }
    setPanelNote(MSG.tokenSaved);
    updatePanel();
    renderControls();
  }

  const tokenSave = labelledButton("tbtn", "i-check", "保存");
  tokenSave.button.addEventListener("click", saveToken);

  const tokenDelete = armedButton({
    cls: "tbtn tbtn--danger",
    armedCls: "tbtn tbtn--armed",
    iconId: "i-x",
    label: TOKEN_DELETE_LABEL,
    armedLabel: TOKEN_DELETE_ARMED_LABEL,
    onConfirm: () => {
      clearToken(store);
      tokenInput.value = "";
      setPanelNote(MSG.tokenCleared);
      updatePanel();
      renderControls();
    },
  });

  function updatePanel() {
    const withToken = hasToken(store);
    // 「設定済みかどうか」だけ。長さも先頭数文字も出さない
    tokenState.textContent = withToken ? "状態: 設定済み" : "状態: 未設定";
    tokenDelete.button.disabled = !withToken;
    tokenDelete.disarm();
  }

  function buildPanel() {
    const label = el("label", null, "公開用トークン");
    label.htmlFor = tokenInput.id;

    const hint = el("p", "fhint", MSG.tokenHint);
    hint.id = "pub-token-hint";

    const field = el("div", "field2");
    field.appendChild(label);
    field.appendChild(tokenInput);
    field.appendChild(hint);

    const acts = el("div", "pubpanel__acts");
    acts.appendChild(tokenSave.button);
    acts.appendChild(tokenDelete.button);

    els.panel.replaceChildren(field, acts, tokenState, panelNote);
    setPanelNote(null);
    updatePanel();
  }

  function setPanelOpen(open) {
    els.panel.hidden = !open;
    settings.button.setAttribute("aria-expanded", String(open));
    if (open) {
      setPanelNote(null);
      updatePanel();
      tokenInput.focus();
      return;
    }
    // 閉じるときも空にする。保存済みのトークンではなく打ちかけの文字列だが、
    // 「この欄にトークンが載っているのは打っている最中だけ」を無条件にしておく
    tokenInput.value = "";
  }

  /* ── 公開 ────────────────────────────────────────────── */

  /**
   * 失敗の見せ方を分ける。分けないと、直せないものに直し方を添えることになる。
   *
   * - StoreWriteError: PUT は通っている（sync.publish は PUT の後にしか書かない）
   * - 409 かつ保存領域に書けない: 「取り込んで公開し直す」が成立しない端末
   * - 409: 取り込みボタンを添える
   * - それ以外: GitHubError の文言をそのまま出す（日本語で書かれている）
   */
  function showPublishFailure(error) {
    console.error("publish-ui: 公開に失敗しました", error);

    // dirty をここで聞き直す。以前は呼び出し側（doPublish）の finally だけが
    // やっており、**この関数を別の場所から呼ぶと表示だけが取り残される**という
    // 暗黙の結合になっていた（設計書 §13）。setDirty は値が同じなら何もしないので、
    // finally と二重に呼ばれても描き直しは 1 回で済む
    refreshDirty();

    if (error instanceof StoreWriteError) {
      // PUT は通っている。ただし控えを書けていないので、ストアから見れば
      // まだ「未公開の変更あり」のまま ── dirty は勝手に下ろさず聞き直す。
      // 状況は文言で説明する
      const nodes = [line(MSG.publishedNotRecorded), line(MSG.cannotPersist)];
      // 公開そのものは済んでいるので、コミットへのリンクは出せる。
      // sync.publish() が例外に載せてくれる（設計書 §13）── 出さないと、
      // この端末では「本当に公開できたのか」を確かめる手段がリポジトリを
      // 自分で見に行くことだけになる
      const link = commitLink(error.commitUrl);
      if (link) nodes.push(link);
      setStatus(nodes, "warn");
      return;
    }

    if (error instanceof GitHubError && error.status === 409) {
      if (!canPersist(store, sizeOf(getData()))) {
        setStatus([line(MSG.conflictUnverifiable), line(MSG.cannotPersist)], "error");
        return;
      }
      // 起動時のバーが出たまま公開して 409 になると、取り込みボタンが
      // 2 つ並ぶ。バーの案内はこの失敗に追い越されているので引っ込め、
      // 取り込みの入口を「今出ている理由の隣」1 か所にする
      hideBar();
      setStatus([line(error.message), adoptRow()], "error");
      return;
    }

    const text = error?.message ?? String(error);
    setStatus([line(MSG.publishFailed), line(text, error instanceof DataError)], "error");
  }

  async function doPublish() {
    if (busy) return;
    const data = getData();

    // sync.publish() も検証するが、ここでも通す。通信を始める前に止めたいのと、
    // 「データが直っていない」と「GitHub が受け付けなかった」を別の文言で
    // 出したいため（前者は再試行しても直らない）
    try {
      validate(data);
    } catch (error) {
      console.error("publish-ui: 検証に通らないため公開しません", error);
      setStatus(
        [line("この内容では公開できません。"), line(error?.message ?? String(error), true)],
        "error"
      );
      return;
    }

    setBusy("publish");
    setStatus([line("公開しています…")], "ok");
    try {
      const { commitUrl, conflictChecked } = await sync.publish(data);
      // === false ではなく !== true。将来この項目が返らなくなったときに
      // 警告が黙って消えるより、余分に出るほうがまだよい
      const skipped = conflictChecked !== true;
      const nodes = [line(MSG.published)];
      if (skipped) nodes.push(line(MSG.conflictCheckSkipped));
      const link = commitLink(commitUrl);
      if (link) nodes.push(link);
      setStatus(nodes, skipped ? "warn" : "ok");
    } catch (error) {
      showPublishFailure(error);
    } finally {
      setBusy(null);
      refreshDirty();
    }
  }

  /* ── 取り込み ────────────────────────────────────────── */

  /** 取り込みボタンを 1 つ置いた行。409 の案内とバーの両方で使う。 */
  function adoptRow() {
    const row = el("div", "pubstat__row");
    row.appendChild(
      armedButton({
        cls: "tbtn",
        armedCls: "tbtn tbtn--armed",
        iconId: "i-arrow-right",
        label: ADOPT_LABEL,
        armedLabel: ADOPT_ARMED_LABEL,
        onConfirm: () => launch(doAdopt, "publish-ui: 取り込みの処理が中断しました"),
      }).button
    );
    return row;
  }

  /**
   * リモートを取り込む。手元の未公開の変更は消える。
   * 呼ばれるのは 2 度押しを通った先だけ ── 自動では絶対に呼ばない。
   */
  async function doAdopt() {
    if (busy) return;
    setBusy("adopt");
    setStatus([line("取り込んでいます…")], "ok");

    let data;
    // base を書けなかった取り込み。中身は入れ替わっているので画面は進めるが、
    // 「取り込みました」だけを出すと記録が残っていないことが伝わらない
    let notRecorded = false;
    try {
      data = await sync.adoptRemote();
    } catch (error) {
      console.error("publish-ui: 取り込みに失敗しました", error);
      // **下書きだけは入れ替わっている場合がある**（storeAdopted は下書き →
      // base の順に書く）。それを「取り込めませんでした」と言って画面を
      // 古いまま据え置くと、保存領域にはリモートが入っているのに画面は前の
      // 内容、という食い違いが残り、次の編集がその古い内容を保存し直して
      // 取り込みを黙って巻き戻す（設計書 §13）。画面だけは進める
      if (error.adopted) {
        notRecorded = true;
        data = error.adopted;
      } else {
        setStatus(
          [line(MSG.adoptFailed), line(error?.message ?? String(error), true)],
          "error"
        );
        return;
      }
    } finally {
      setBusy(null);
      refreshDirty();
    }

    // ここから先は取り込み済み。描き直しに失敗しても「取り込めませんでした」とは
    // 言わない（下書きはもう入れ替わっているので、それは嘘になる）。
    // 画面の更新の成否は schedule.js の safeDraw が自分の文言で伝える
    hideBar();
    setStatus(
      notRecorded ? [line(MSG.adopted), line(MSG.cannotPersist)] : [line(MSG.adopted)],
      notRecorded ? "warn" : "ok"
    );
    // 押したボタンは hideBar / setStatus で文書から消えている。
    // 戻し先を用意しないとフォーカスが <body> へ落ちる
    focusFallback();
    onAdopt(data);
  }

  /**
   * 消えたボタンからフォーカスを逃がす先。ツールバーの先頭（トークンの有無に
   * よらず必ず 1 つはある）へ戻す。event-editor の fallbackFocus と同じ考え方。
   */
  function focusFallback() {
    const target = els.controls.children[0];
    if (target && typeof target.focus === "function") target.focus();
  }

  /* ── 画面上部のバー ──────────────────────────────────── */

  function hideBar() {
    els.bar.replaceChildren();
    els.bar.hidden = true;
    barButtons.length = 0;
  }

  function showBar(message, tone, buttons) {
    els.bar.className = `syncbar syncbar--${tone}`;
    els.bar.replaceChildren(el("p", "syncbar__msg", message));
    barButtons.length = 0;
    for (const button of buttons) {
      els.bar.appendChild(button);
      barButtons.push(button);
    }
    els.bar.hidden = false;
  }

  /**
   * 起動時の案内。source は sync.load() の判断そのままで、ここでは作り直さない。
   *
   * - remote-is-newer: 取り込むか手元を残すかを選ばせる。黙って上書きしない
   * - offline: 確認できなかったことだけ伝える。機能は 1 つも落とさない
   * - use-local / use-remote: バーは出さない
   *
   * 未公開の変更の有無は source から導かない。use-local は「リモートが
   * 進んでいない」であって編集の有無ではなく、一度も編集していない端末でも
   * 2 回目の読み込みから use-local になる。ストアに聞けば、リモートを
   * 見ていない offline でも同じ精度で答えが出る。
   *
   * ここが持つのは source に依存する同期バーの出し分けだけ。パネル・状態・
   * 公開ボタンの DOM への挿入は createPublishUI() 本体の末尾で済ませてあり、
   * ここでは待たない（下のコメント参照）。
   */
  function start(source) {
    if (source === "remote-is-newer") {
      const adopt = armedButton({
        cls: "tbtn",
        armedCls: "tbtn tbtn--armed",
        iconId: "i-arrow-right",
        label: ADOPT_LABEL,
        armedLabel: ADOPT_ARMED_LABEL,
        onConfirm: () => launch(doAdopt, "publish-ui: 取り込みの処理が中断しました"),
      }).button;
      const keep = labelledButton("tbtn", "i-x", "自分の変更を残す").button;
      keep.addEventListener("click", () => {
        hideBar();
        setStatus([line(MSG.keptLocal)], "warn");
      });
      showBar(MSG.remoteIsNewer, "warn", [adopt, keep]);
      return;
    }

    if (source === "offline") {
      const close = labelledButton("tbtn", "i-x", "閉じる").button;
      close.addEventListener("click", hideBar);
      showBar(MSG.offline, "info", [close]);
      return;
    }

    hideBar();
  }

  // ここまでで DOM への挿入を終える。**start() まで待たないこと。**
  // これらが読むのは store だけで（refreshDirty → sync.hasUnpublishedChanges() は
  // localStorage を見る、getData はクリックされるまで呼ばれない）、旅程データを
  // 必要としない。start() に残すと、load() が投げた端末では replaceChildren が
  // 一度も走らず、公開ボタンもトークン設定も DOM に現れない ──
  // events.json の手編集を廃止した以上、それは復旧手段がゼロになるということ
  // （レビューで見つかった Critical、Task 5）。
  buildPanel();
  setPanelOpen(false);
  clearStatus();
  refreshDirty();
  renderControls();

  return {
    start,
    /**
     * 予定を保存したあとに呼ぶ。値は渡さない ── 未公開の変更があるかは
     * ストアが知っている。呼び出し側に判断を持たせると必ずずれる。
     */
    refreshDirty,
    isDirty: () => dirty,
  };
}
