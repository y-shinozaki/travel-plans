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
import { validateEvents, EventDataError } from "./validate.js";

/**
 * 画面に出す文言。テストから参照できるよう外に出してある
 * （「この文字列が出ること」を実装の写経ではなく定数で確かめるため）。
 */
export const MESSAGES = {
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
  offline: "最新の旅程を確認できませんでした。手元のデータをそのまま表示しています",
  remoteIsNewer:
    "別の端末で新しい旅程が公開されています。" +
    "取り込むと、この端末の未公開の変更は失われます",
  keptLocal:
    "手元の変更を残しました。このまま公開すると" +
    "「リモートが更新されています」と表示されます（先に取り込みが必要です）",
  adopted: "取り込みました。表示を最新の内容に更新しました",
  adoptedNotDrawn:
    "取り込みは済みましたが、画面の更新に失敗しました。ページを再読み込みしてください",
  adoptFailed: "取り込めませんでした。",
  publishFailed: "公開できませんでした。",
  tokenSaved: "トークンを保存しました",
  tokenCleared: "トークンを削除しました",
  tokenEmpty: "トークンを入力してください",
  tokenHint:
    "GitHub の fine-grained personal access token（このリポジトリの Contents 書き込み権限）。" +
    "この端末のブラウザにだけ保存され、画面に表示し直すことはありません",
};

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
function canPersist(store) {
  try {
    store.write(PROBE_KEY, 1);
    return true;
  } catch {
    return false;
  } finally {
    store.remove(PROBE_KEY);
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
  return { button, disarm };
}

/**
 * @param {object} deps
 * @param {{controls:HTMLElement, panel:HTMLElement, status:HTMLElement, bar:HTMLElement}} deps.els
 * @param {object} deps.store store.js の createStore
 * @param {object} deps.sync sync.js の createSync
 * @param {() => object} deps.getData 公開する旅程データ全体
 * @param {(data:object) => void} deps.onAdopt 取り込んだデータで画面を描き直す
 */
export function createPublishUI({ els, store, sync, getData, onAdopt }) {
  /** 未公開の変更があるか。分からないときは false（嘘の警告を出さない）。 */
  let dirty = false;
  /** 公開・取り込みの最中。二重送信を止めるためだけに持つ。 */
  let busy = false;

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

  publish.button.addEventListener("click", () => {
    void doPublish();
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
    publish.span.textContent = busy
      ? PUBLISH_BUSY_LABEL
      : dirty
        ? PUBLISH_DIRTY_LABEL
        : PUBLISH_LABEL;
    publish.button.disabled = busy;
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

  function setBusy(next) {
    busy = next;
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
      setPanelNote(MESSAGES.tokenEmpty);
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
    setPanelNote(MESSAGES.tokenSaved);
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
      setPanelNote(MESSAGES.tokenCleared);
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

    const hint = el("p", "fhint", MESSAGES.tokenHint);
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
    }
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

    if (error instanceof StoreWriteError) {
      // 公開自体は済んでいるので、未公開の変更は無い
      setDirty(false);
      setStatus([line(MESSAGES.publishedNotRecorded), line(MESSAGES.cannotPersist)], "warn");
      return;
    }

    if (error instanceof GitHubError && error.status === 409) {
      if (!canPersist(store)) {
        setStatus([line(MESSAGES.conflictUnverifiable), line(MESSAGES.cannotPersist)], "error");
        return;
      }
      setStatus([line(error.message), adoptRow()], "error");
      return;
    }

    const text = error?.message ?? String(error);
    setStatus([line(MESSAGES.publishFailed), line(text, error instanceof EventDataError)], "error");
  }

  async function doPublish() {
    if (busy) return;
    const data = getData();

    // sync.publish() も検証するが、ここでも通す。通信を始める前に止めたいのと、
    // 「データが直っていない」と「GitHub が受け付けなかった」を別の文言で
    // 出したいため（前者は再試行しても直らない）
    try {
      validateEvents(data);
    } catch (error) {
      console.error("publish-ui: 検証に通らないため公開しません", error);
      setStatus(
        [line("この内容では公開できません。"), line(error?.message ?? String(error), true)],
        "error"
      );
      return;
    }

    setBusy(true);
    setStatus([line("公開しています…")], "ok");
    try {
      const { commitUrl, conflictChecked } = await sync.publish(data);
      setDirty(false);
      const nodes = [line(MESSAGES.published)];
      if (conflictChecked === false) nodes.push(line(MESSAGES.conflictCheckSkipped));
      const link = commitLink(commitUrl);
      if (link) nodes.push(link);
      setStatus(nodes, conflictChecked === false ? "warn" : "ok");
    } catch (error) {
      showPublishFailure(error);
    } finally {
      setBusy(false);
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
        onConfirm: () => void doAdopt(),
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
    setBusy(true);
    setStatus([line("取り込んでいます…")], "ok");

    let data;
    try {
      data = await sync.adoptRemote();
    } catch (error) {
      console.error("publish-ui: 取り込みに失敗しました", error);
      setStatus(
        [line(MESSAGES.adoptFailed), line(error?.message ?? String(error), true)],
        "error"
      );
      return;
    } finally {
      setBusy(false);
    }

    // ここから先は取り込み済み。描き直しに失敗しても「取り込めませんでした」とは
    // 言わない（下書きはもう入れ替わっているので、それは嘘になる）
    hideBar();
    setDirty(false);
    setStatus([line(MESSAGES.adopted)], "ok");
    try {
      onAdopt(data);
    } catch (error) {
      console.error("publish-ui: 取り込んだあとの再描画に失敗しました", error);
      setStatus(
        [line(MESSAGES.adoptedNotDrawn), line(error?.message ?? String(error), true)],
        "warn"
      );
    }
  }

  /* ── 画面上部のバー ──────────────────────────────────── */

  function hideBar() {
    els.bar.replaceChildren();
    els.bar.hidden = true;
  }

  function showBar(message, tone, buttons) {
    els.bar.className = `syncbar syncbar--${tone}`;
    els.bar.replaceChildren(el("p", "syncbar__msg", message));
    for (const button of buttons) els.bar.appendChild(button);
    els.bar.hidden = false;
  }

  /**
   * 起動時の案内。source は sync.load() の判断そのままで、ここでは作り直さない。
   *
   * - remote-is-newer: 取り込むか手元を残すかを選ばせる。黙って上書きしない
   * - offline: 確認できなかったことだけ伝える。機能は 1 つも落とさない
   * - use-local: 未公開の変更がある。ボタンの文言だけで伝える（バーは出さない）
   * - use-remote: 揃っている。何も出さない
   */
  function start(source) {
    renderControls();
    buildPanel();
    setPanelOpen(false);
    clearStatus();

    if (source === "remote-is-newer") {
      dirty = true;
      renderControls();
      const adopt = armedButton({
        cls: "tbtn",
        armedCls: "tbtn tbtn--armed",
        iconId: "i-arrow-right",
        label: ADOPT_LABEL,
        armedLabel: ADOPT_ARMED_LABEL,
        onConfirm: () => void doAdopt(),
      }).button;
      const keep = labelledButton("tbtn", "i-x", "自分の変更を残す").button;
      keep.addEventListener("click", () => {
        hideBar();
        setStatus([line(MESSAGES.keptLocal)], "warn");
      });
      showBar(MESSAGES.remoteIsNewer, "warn", [adopt, keep]);
      return;
    }

    if (source === "use-local") {
      dirty = true;
      renderControls();
      hideBar();
      return;
    }

    if (source === "offline") {
      // 未公開の変更があるかは確かめようがない。分からないものを
      // 「あります」とは出さない（dirty は触らない）
      const close = labelledButton("tbtn", "i-x", "閉じる").button;
      close.addEventListener("click", hideBar);
      showBar(MESSAGES.offline, "info", [close]);
      return;
    }

    hideBar();
  }

  return {
    start,
    /** 予定を保存したときに呼ぶ。未公開の変更があることをボタンに出す。 */
    markDirty: () => setDirty(true),
    isDirty: () => dirty,
  };
}
