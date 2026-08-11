/**
 * 予定の編集。詳細シートと同じ器（sheet.js）にフォームを載せ、
 * 採番・併合・保存前の検査・削除までを受け持つ。
 *
 * DOM も store も要らない部分（採番・併合・配列の差し替え）は純粋な関数として
 * 切り出してある。ここが壊れたときの失われ方は静かで、画面を見ても気付けない
 * ── 「保存はできたが image が消えていた」は、次に画像を見に行くまで
 * 誰にも分からない。だから Node のテストで押さえる。
 *
 * 設計書 §6 に対応。
 */

import { el, escapeHtml } from "./dom.js";
import { icon } from "./icons.js";
import { renderEventDetail } from "./sheet.js";
import { emptyEvent, eventFormHtml, readEventForm, formProblemDetails } from "./event-form.js";
import { validateEvents, EventDataError } from "./validate.js";
import { decToHHMM } from "./time.js";

/* ── 純粋な部分（テストはここを突く） ───────────────────── */

/**
 * 既存と衝突しない id を採番する。
 *
 * 件数から作った候補が埋まっていれば次を試す。events.json の id は
 * ev-001 から連番だが、途中を削除したデータでは件数と最大値がずれるので、
 * 「使われていないこと」を必ず確かめる。id が重複すると地図の再描画判定
 * （map.js の signatureOf）で別の地点が同じものとして扱われる。
 */
export function nextEventId(events) {
  const used = new Set(events.map((ev) => ev?.id));
  for (let n = events.length + 1; ; n++) {
    const id = `ev-${String(n).padStart(3, "0")}`;
    if (!used.has(id)) return id;
  }
}

/**
 * 同じ時刻を指しているか。
 *
 * フォームの時刻は 10 進 → HH:MM → 10 進を往復する。分に丸められるので
 * 10.58 は 10.583333333333334 になって戻ってくる（実データに 4 件ある）。
 * 表示は decToHHMM が同じ文字列に戻すので変わらないが、触ってもいない値が
 * 公開時の差分に載る。events.json の差分は人が読むものなので、
 * 「同じ時刻なら元の数値を残す」で無関係なノイズを出さない。
 */
const sameClock = (a, b) =>
  Number.isFinite(a) && Number.isFinite(b) && decToHHMM(a) === decToHHMM(b);

/**
 * 既存イベントにフォームの入力を併合する。置き換えではない。
 *
 * フォームには image / imagePos / icon の入力欄が無い。readEventForm() の
 * 戻り値でそのまま置き換えると、タイトルを 1 文字直しただけでこれらのキーが
 * 消える。しかも 3 つとも省略できる項目なので validateEvents() は通ってしまい、
 * 消えたことは画像が出なくなるまで誰も気付かない。
 *
 * id も元のものを必ず残す。フォームは id を返さないので展開だけでも残るが、
 * 「編集で id が変わることはない」を目に見える形にしておく。
 */
export function mergeEvent(original, input) {
  const merged = { ...original, ...input, id: original.id };

  // 時刻を触っていないなら、往復で丸まった値ではなく元の数値を残す（sameClock）
  for (const key of ["start", "end"]) {
    if (sameClock(original[key], merged[key])) merged[key] = original[key];
  }

  // 終日に切り替えたときは時刻を落とす。readEventForm は終日のとき
  // start / end を返さないので、併合しただけでは元の時刻が残る。
  // validateEvent は終日イベントの時刻を見ないため、残っても検査は通り、
  // 終日に戻したはずの予定が古い時刻を抱えたまま公開されてしまう
  if (merged.allDay) {
    delete merged.start;
    delete merged.end;
  }
  return merged;
}

/** イベントを差し替えた（同じ id が無ければ末尾に足した）新しいデータを返す。 */
export function withEvent(data, ev) {
  const index = data.events.findIndex((e) => e?.id === ev.id);
  const events =
    index === -1 ? [...data.events, ev] : data.events.map((e, i) => (i === index ? ev : e));
  return { ...data, events };
}

/** イベントを取り除いた新しいデータを返す。 */
export function withoutEvent(data, id) {
  return { ...data, events: data.events.filter((e) => e?.id !== id) };
}

/* ── 画面 ────────────────────────────────────────────── */

const DELETE_LABEL = "削除";
const DELETE_ARMED_LABEL = "もう一度で削除";

/** シート本文を組み立てられなかったときに、シートの中で伝える文言。 */
const failureBody = (text) => `<p class="ferror ferror--block">${escapeHtml(text)}</p>`;

/**
 * @param {object} deps
 * @param {{open:Function, close:Function}} deps.sheet シートの器（sheet.js）
 * @param {HTMLElement} deps.bodyEl シート本文。入力欄はここから引く
 * @param {() => object} deps.getData 現在の旅程データ全体（days と events を持つ）
 * @param {(data:object) => void} deps.commit 保存して画面へ反映する。失敗は投げること
 * @param {HTMLElement|null} deps.fallbackFocus 戻し先の要素が無いときの逃がし先
 */
export function createEventEditor({ sheet, bodyEl, getData, commit, fallbackFocus = null }) {
  let editMode = false;

  /* ── 部品 ── */

  /** フッターのボタン。文字は textContent、アイコンだけ innerHTML で入れる。 */
  function footButton(cls, iconId, label) {
    const button = el("button", cls);
    button.type = "button";
    button.innerHTML = icon(iconId, "ico--sm");
    button.appendChild(el("span", null, label));
    return button;
  }

  /** ボタンの文字だけ差し替える（アイコンは残す）。 */
  const setButtonLabel = (button, label) => {
    button.querySelector("span").textContent = label;
  };

  /**
   * シート本文から欄を引く。無ければどの id かを名指しして投げる。
   *
   * id の出どころは event-form.js のマークアップ 1 か所だけ。ずれたときに
   * 「黙って効かない部品があるフォーム」を出さないよう、引く側は必ずここを通す。
   */
  function requireField(id) {
    const node = bodyEl.querySelector(`#${id}`);
    if (!node) {
      throw new Error(`event-editor: 入力欄 #${id} が見つかりません`);
    }
    return node;
  }

  /**
   * 入力欄の値を文字列で返す。
   *
   * チェックボックスは checked から作る。DOM の input.value はチェックの
   * 有無に関わらず "on" を返すので、そのまま流すと終日が常に true になる
   * （event-form.js の readEventForm が要求している約束）。
   */
  function getValue(id) {
    const node = requireField(id);
    return node.type === "checkbox" ? (node.checked ? "on" : "") : node.value;
  }

  /**
   * いまフォームに入っている値をまとめた文字列。開いた直後の値と比べて
   * 「触られたか」を見るためだけに使う（canClose）。
   *
   * 読めなければ null。フォームが崩れている場面で「触られた」と読んで
   * シートを閉じられなくすると、出口が無くなる ── 判断できないときは
   * 止めない側へ倒す。
   */
  function readFormText() {
    try {
      return JSON.stringify(readEventForm(getValue));
    } catch {
      return null;
    }
  }

  /* ── エラー表示（シートの中に出し、閉じない） ── */

  const errorBox = () => bodyEl.querySelector("#f-error");

  /**
   * エラー表示を消す。**role と aria-invalid も必ず一緒に消すこと。**
   *
   * 以前は className と中身しか消していなかったので、role="alert" が
   * 空の箱に残り続けた。空の live region は読み上げこそ起こさないが、
   * 支援技術から見ると「まだ警告の器がそこにある」状態で、次に別の理由で
   * ここへ文字を入れた瞬間に、消したはずの前の文脈として読まれる。
   * aria-invalid も同じで、直した欄に付いたままだと「まだ不正」と伝わる。
   */
  function clearProblems() {
    for (const node of bodyEl.querySelectorAll("[aria-invalid]")) {
      node.removeAttribute("aria-invalid");
    }
    const box = errorBox();
    if (!box) return;
    box.innerHTML = "";
    box.className = "";
    box.removeAttribute("role");
  }

  /** 直すべき点を 1 行ずつ並べる。 */
  function showProblems(messages) {
    const box = errorBox();
    if (!box) return;
    box.innerHTML = "";
    box.className = "fproblems";
    box.setAttribute("role", "alert");
    for (const message of messages) {
      const line = el("p", "ferror");
      line.innerHTML = icon("i-x", "ico--sm");
      line.appendChild(el("span", null, message));
      box.appendChild(line);
    }
    // 本文が長いとエラーは折り返しの下に隠れる。押したのに何も起きていない
    // ように見えるので、必ず見える位置まで送る
    box.scrollIntoView({ block: "nearest" });
  }

  /**
   * 例外（全体検査・保存・組み立ての失敗）を伝える。
   * validateEvents のメッセージは複数行なので .ferror--block で改行を残す。
   * lead は「何をしようとして失敗したのか」の 1 行目。
   */
  function showFailure(error, lead = "保存に失敗しました。") {
    const box = errorBox();
    const text =
      error instanceof EventDataError
        ? `この内容では保存できません。\n${error.message}`
        : `${lead}\n${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
    if (!box) {
      // フォームが出ていない（削除の失敗など）。シートごと文言に差し替える
      sheet.open("保存できません", failureBody(text));
      return;
    }
    box.innerHTML = "";
    box.className = "fproblems";
    box.setAttribute("role", "alert");
    box.appendChild(el("p", "ferror ferror--block", text));
    box.scrollIntoView({ block: "nearest" });
  }

  /* ── 保存 ── */

  /**
   * 再描画のあと、編集した予定の要素へフォーカスを戻す。
   *
   * sheet.close() が戻すのは「シートを開いた要素」だが、保存するとカレンダーは
   * 作り直されるので、その要素はもう文書にいない（detach された要素への
   * focus() は何も起きず、フォーカスは body へ落ちる）。同じ id を持つ
   * 新しい要素（dom.js の makeSelectable が data-ev-id を付けている）を
   * 探し直す。表示時間帯の外にある予定は描かれないので、
   * 見つからなければツールバーへ逃がす。
   */
  function focusEvent(id) {
    const node = id ? document.querySelector(`[data-ev-id="${CSS.escape(id)}"]`) : null;
    (node ?? fallbackFocus)?.focus();
  }

  /**
   * 配列全体を検査してから保存する。
   *
   * formProblems() は 1 件しか見ないので id の重複を検出できない。しかも
   * 渡された dayCount をそのまま信じるので、古い日数を渡せば範囲外の
   * startDay が素通りする。validateEvents() は data.days を自分で数えるため、
   * ここが最後の砦になる ── 省略すると「保存はできたが次の読み込みで
   * ページが起動しない」データを作れてしまう。
   */
  function applyChange(next, focusId) {
    try {
      validateEvents(next);
      commit(next);
    } catch (error) {
      console.error("event-editor: 保存できませんでした", error);
      showFailure(error);
      return;
    }
    // 保存・削除が通った直後なので、未保存の確認は飛ばす（force）。
    // ここで述語に聞くと、いま保存したばかりの入力を「未保存」と読んで
    // シートが閉じなくなる
    sheet.close(true);
    focusEvent(focusId);
  }

  function save(original) {
    const data = getData();
    clearProblems();

    const input = readEventForm(getValue);

    // dayCount は必ず今の days から渡す。控えを持ち回ると、日程を縮めた
    // あとに古い日数で検査してしまう
    const problems = formProblemDetails(input, data.days.length);
    if (problems.length) {
      // 不備のある欄を全部名指しする。以前はタイトル欄にしか付けていなかったので、
      // 緯度や時刻を直すべき場面で支援技術には「どこが悪いのか」が伝わらなかった
      for (const { inputId } of problems) {
        if (!inputId) continue;
        bodyEl.querySelector(`#${inputId}`)?.setAttribute("aria-invalid", "true");
      }
      showProblems(problems.map((p) => p.message));
      return;
    }

    // 新規は採番だけ。元が無いのでフォームの戻り値をそのまま使ってよい。
    // 既存は必ず併合する（mergeEvent のコメントを参照）
    const ev = original
      ? mergeEvent(original, input)
      : { id: nextEventId(data.events), ...input };

    applyChange(withEvent(data, ev), ev.id);
  }

  /* ── シートの中身 ── */

  /** 読み取り専用の詳細。フッターに「この予定を編集」を置く。 */
  function openDetail(ev) {
    let body;
    try {
      body = renderEventDetail(ev, getData().days);
    } catch (error) {
      // renderEventDetail(...) は sheet.open() の引数として評価されるので、
      // ここで落ちると sheet.open() 自体が呼ばれない ── 画面は微動だにせず、
      // 利用者には「押し損ねた」のか「壊れた」のかが区別できない。
      // 本文の生成に失敗したときは、シートは必ず開いてその中で失敗を伝える。
      console.error(
        `event-editor: 詳細の生成に失敗しました（${ev?.id ?? "id なし"} / ${ev?.title ?? ""}）`,
        error
      );
      sheet.open(
        "詳細を表示できません",
        failureBody(
          `この予定（${ev?.id ?? "id なし"}）の詳細を組み立てられませんでした。\n` +
            "旅程データが壊れている可能性があります。\n\n" +
            `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`
        )
      );
      return;
    }

    const edit = footButton("btn grow", "i-edit", "この予定を編集");
    edit.addEventListener("click", () => openForm(ev));
    sheet.open("予定の詳細", body, [edit]);
  }

  /**
   * 編集フォーム。original が null なら新規追加。
   * 検査に落ちたときは開いたまま、入力もそのまま残す（描き直さない）。
   */
  function openForm(original) {
    const data = getData();

    let body;
    let draft;
    try {
      draft = original ?? emptyEvent(data.days.length);
      body = eventFormHtml(draft, data.days);
    } catch (error) {
      console.error("event-editor: フォームを組み立てられませんでした", error);
      sheet.open(
        "編集できません",
        failureBody(
          "編集フォームを組み立てられませんでした。\n" +
            "旅程データが壊れている可能性があります。\n\n" +
            `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`
        )
      );
      return;
    }

    const foot = [];
    const saveBtn = footButton("btn grow", "i-check", "保存");
    // save() が投げると、リスナーの外へ抜けて画面には何も出ない ──
    // 「保存を押したのに無反応」が一番困る。入力の読み取り（フォームの
    // 組み立てが崩れている場合）まで含めて、必ずシートの中で伝える
    saveBtn.addEventListener("click", () => {
      try {
        save(original);
      } catch (error) {
        console.error("event-editor: 入力を読み取れませんでした", error);
        showFailure(error, "入力を読み取れませんでした。");
      }
    });
    foot.push(saveBtn);

    if (original) {
      // ダイアログ（confirm）は使わない。1 度目で身構え、2 度目で消す
      const del = footButton("btn btn--ghost", "i-x", DELETE_LABEL);
      let armed = false;
      del.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          del.className = "btn btn--danger";
          setButtonLabel(del, DELETE_ARMED_LABEL);
          del.title = "もう一度押すと削除します";
          return;
        }
        applyChange(withoutEvent(getData(), original.id), null);
      });
      foot.push(del);
    }

    /*
     * 閉じると未保存の入力が黙って消える、という穴を塞ぐ（設計書 §13）。
     * confirm() は使えない規約なので、削除ボタンと同じ「1 度目で身構え、
     * 2 度目で実行」にする ── 1 度目は閉じずに理由を出し、2 度目で捨てる。
     *
     * 触っていないフォームは素通しする。開いて眺めただけの予定を閉じるのに
     * 2 度押させるのは、守るものが無いのに手間だけ増やすことになる。
     */
    let snapshot = null;
    let discardArmed = false;
    const canClose = () => {
      // 読めない（フォームが崩れている・まだ撮れていない）なら止めない。
      // 閉じられなくなるほうが困る
      const current = readFormText();
      if (current === null || snapshot === null || current === snapshot) return true;
      if (discardArmed) return true;
      discardArmed = true;
      showProblems([
        "保存していない入力があります。もう一度閉じると、この入力は捨てられます。",
      ]);
      return false;
    };

    sheet.open(original ? "予定を編集" : "予定を追加", body, foot, { canClose });

    // **スナップショットは sheet.open() のあとで撮る。** 前で撮ると、本文の
    // HTML がまだ文書に入っていないので requireField が投げ、readFormText が
    // null を返す ── その結果「触っていないフォームも閉じるのを断る」になる。
    // 2026-08-11 に実ページで見つけた。**テストのスタブは open の前から
    // 入力欄を持っているので、この順序の誤りを再現できない**（下のテストは
    // open() の中で値を変えて、撮る時点が open より後であることを見ている）
    snapshot = readFormText();

    // 終日の予定は時刻を持たないので、切り替えに合わせて時刻欄を出し入れする。
    //
    // ここで落ちても例外を外へ出さない。抜けると「トグルだけ黙って効かない
    // フォーム」が開いたまま残り、画面には理由が何も出ない。他の DOM 参照
    // （requireField / errorBox）と同じく、名指しして画面の中で伝える。
    try {
      const allDay = requireField("f-allday");
      const times = requireField("f-times");
      const syncTimes = () => times.classList.toggle("is-hidden", allDay.checked);
      allDay.addEventListener("change", syncTimes);
      syncTimes();
    } catch (error) {
      console.error("event-editor: 終日の切り替えを配線できませんでした", error);
      showFailure(error, "このフォームを正しく組み立てられませんでした。");
    }
  }

  return {
    /** カレンダー・地図から呼ばれる選択の入口。編集モードなら直接フォーム。 */
    select: (ev) => (editMode ? openForm(ev) : openDetail(ev)),
    openNew: () => openForm(null),
    editMode: () => editMode,
    setEditMode: (on) => {
      editMode = on;
    },
  };
}
