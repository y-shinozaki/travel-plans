/**
 * 持ち物リストの描画。
 *
 * 通常時は読むだけの静かな見た目、「リストを編集」で編集モードへ（設計書 §7.3）。
 * 2 つのモードを別の関数にせず editing で分けるのは、行の構造を 1 か所に
 * 保つため ── 2 つに割ると、data-item-id の付け忘れのような
 * 「片方だけ動かない」がドラッグの配線まで見つからない。
 *
 * 値は必ず el()（textContent）で入れる。innerHTML に入るのは icon() が返す
 * 定数だけ。ブラウザで入力した文字列を、リポジトリ書き込み権限を持つトークンを
 * 抱えたページ自身が描画するため（CLAUDE.md の規約）。
 *
 * すべての操作コントロール（↑↓・削除・名前とメモの入力欄・人ごとの状態ボタン）に
 * `dataset.focusKey` を付ける。`itemFocusKey()` / `groupFocusKey()`（focus-key.js）が
 * id から作る ── 位置から作ると、並べ替えたその瞬間に「動いた」という事実そのものでキーが変わってしまい、
 * 何のためのキーか分からなくなる。packing.js の draw() が再描画のたびに
 * `document.activeElement` のこのキーを控え、描き直したあと同じキーを持つ要素へ
 * フォーカスを戻す（event-editor.js の focusEvent と同じ考え方 ── mount.replaceChildren()
 * は毎回すべてのノードを作り直すので、押した瞬間の要素はもう文書にいない）。
 */

import { el } from "./dom.js";
import { icon } from "./icons.js";
import { progressOf, groupProgressOf, PLACE_META, PLACE_KEYS } from "./packing-data.js";
import { itemFocusKey, groupFocusKey } from "./focus-key.js";
import { iconButton, armedIconButton, CHECK_MARK } from "./row-controls.js";

/** 不要の印。「—」は薄く出す（packing.css の .pkcycle__box--na）。 */
const NA_MARK = "—";

/** 3 状態のうち、いまどれか。na → checked → blank の順で確かめる。 */
function cycleState(item, member) {
  if (item.na?.includes(member) === true) return "na";
  if (item[member] === true) return "checked";
  return "blank";
}

/** 読み上げ文言。状態を言葉にする（設計書: 「雄一: パスポート、未チェック」など）。 */
function cycleLabel(item, memberName, state) {
  const status = state === "checked" ? "チェック済み" : state === "na" ? "不要" : "未チェック";
  return `${memberName}: ${item.name}、${status}`;
}

/**
 * 2 人分の進捗。達成数と細いバー（設計書 §7.3）。
 * 割り算はここで行い、total が 0 のときは 0% にする ── 項目が 1 つも無い状態は
 * 実際に起こる（まだ何も足していないリスト）。
 */
export function renderProgress({ mount, data }) {
  const nodes = [];
  for (const member of ["a", "b"]) {
    const { done, total } = progressOf(data, member);
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    const one = el("div", "pkprog__one");
    one.appendChild(el("p", "pkprog__name", data.members[member]));
    one.appendChild(el("p", "pkprog__count", `${done} / ${total}`));

    const bar = el("div", "pkprog__bar");
    const fill = el("div", "pkprog__fill");
    fill.style.width = `${percent}%`;
    bar.appendChild(fill);
    one.appendChild(bar);

    one.setAttribute("role", "group");
    one.setAttribute("aria-label", `${data.members[member]} の進捗 ${done} / ${total}`);
    nodes.push(one);
  }
  mount.replaceChildren(...nodes);
}

/**
 * 人ごとの欄。ひとつのボタンが押すたびに 3 段階を回る
 * （ブランク → チェック → 不要 → ブランク …）。**モードで役割を変えない** ──
 * 通常モードでも編集モードでも同じボタンが同じように動く（設計を最初
 * 「通常はチェックボックス、編集はピル」で作ってしまい、書き直した経緯は
 * plans/packing-not-applicable.md「描画」参照）。
 *
 * `<input type="checkbox">` ではなく `<button>` にする理由: チェックボックスは
 * 2 状態しか持てず、3 つ目を `indeterminate` で表しても HTML からは設定できない上、
 * 支援技術には「mixed」としか読まれない（「不要」とは意味が違う）。加えて
 * クリックの既定動作（checked の反転）を毎回止める必要が生まれる。
 *
 * いまの状態は cycleState()（このファイル内、item の na / a・b から**読むだけ**）
 * が決める。次の状態への**遷移**は packing-data.js の cycleMember() が持つ ──
 * 描画は状態を読んで見た目を出すだけで、遷移の規則を書き写さない。
 *
 * 3 状態とも同じ 22px の四角にする（packing.css の .pkcycle__box）。
 * 大きさが揃っていれば、どの状態の行でも列が自然に揃う。
 */
function cycleCell(item, member, memberName, onCycle) {
  const state = cycleState(item, member);

  const wrap = el("span", "pkcycle");

  const button = el("button", `pkcycle__box${state === "blank" ? "" : ` pkcycle__box--${state}`}`);
  button.type = "button";
  if (state === "checked") {
    button.innerHTML = CHECK_MARK; // 定数のみ。値は混ぜない
  } else if (state === "na") {
    button.appendChild(el("span", null, NA_MARK));
  }
  // ブランクは枠だけの四角（何も入れない）
  button.setAttribute("aria-label", cycleLabel(item, memberName, state));
  button.dataset.focusKey = itemFocusKey(item.id, `check:${member}`);
  button.addEventListener("click", () => onCycle?.(item.id, member));

  wrap.appendChild(button);
  wrap.appendChild(el("span", null, memberName));
  return wrap;
}

/** 名前とメモ。編集モードでは入力欄になる（設計書 §7.3「行がそのまま入力欄になる」）。 */
function itemBody(item, editing, onRename) {
  const body = el("div", "pkitem__body");
  if (!editing) {
    // 読み取りモードでは名前とメモを同じ行に流す（2026-08-10、縦を詰めるため）。
    // 段を分けると 39 項目で画面 3 つ分を超える。メモは折り返して 2 行目に落ちるので、
    // 長いメモが切り捨てられることはない
    const line = el("p", "pkitem__line");
    line.appendChild(el("span", "pkitem__name", item.name));
    if (item.note) line.appendChild(el("span", "pkitem__note", item.note));
    body.appendChild(line);
    return body;
  }

  const name = document.createElement("input");
  name.className = "inp";
  name.type = "text";
  name.value = item.name;
  name.setAttribute("aria-label", "項目名");
  name.dataset.focusKey = itemFocusKey(item.id, "name");
  name.addEventListener("change", () => onRename?.(item.id, { name: name.value }));

  const note = document.createElement("input");
  note.className = "inp inp--note";
  note.type = "text";
  note.value = item.note ?? "";
  note.placeholder = "メモ";
  note.setAttribute("aria-label", "メモ");
  note.dataset.focusKey = itemFocusKey(item.id, "note");
  note.addEventListener("change", () => onRename?.(item.id, { note: note.value }));

  body.appendChild(name);
  body.appendChild(note);
  return body;
}

/**
 * 入れる場所。読むときはラベル、編集モードでは選ぶだけ。
 *
 * 読み取りモードで未設定の項目は**何も出さない**。「未設定」と書いた
 * チップを 39 個並べても、決めた項目が埋もれるだけで読み取れない。
 *
 * select には focusKey を付ける。選ぶと change → 保存 → 表を作り直すので、
 * 付けないと選んだ直後にフォーカスが飛ぶ（packing.js の scheduleDraw 参照）。
 */
function placeCell(item, editing, onSetPlace) {
  if (!editing) {
    const label = PLACE_META[item.where]?.label;
    if (!label) return null;
    return el("span", "pkplace", label);
  }

  const select = document.createElement("select");
  select.className = "pkplace__pick";
  select.dataset.focusKey = itemFocusKey(item.id, "place");
  select.setAttribute("aria-label", "入れる場所");

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "未設定";
  select.appendChild(blank);

  for (const key of PLACE_KEYS) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = PLACE_META[key].label;
    select.appendChild(option);
  }
  // value は option を足したあとに入れる。先に入れると、その値の option が
  // まだ無いのでブラウザに捨てられ、常に「未設定」で描かれる
  select.value = PLACE_META[item.where] ? item.where : "";
  select.addEventListener("change", () => onSetPlace?.(item.id, select.value));
  return select;
}

function itemRow(item, data, editing, handlers) {
  const row = el("li", "pkitem");
  row.dataset.itemId = item.id;

  if (editing) {
    // ドラッグハンドル。touch-action: none は packing.css 側で付ける。
    // aria-hidden にするのは、ドラッグを使えない人のために ↑↓ ボタンを
    // 併設してあるため ── 両方が読み上げられると同じ操作が 2 回出てくる
    const handle = el("span", "pkdrag");
    handle.innerHTML = icon("i-grip", "ico--sm");
    handle.dataset.dragHandle = "1";
    handle.setAttribute("aria-hidden", "true");
    row.appendChild(handle);
  }

  row.appendChild(itemBody(item, editing, handlers.onRenameItem));

  const place = placeCell(item, editing, handlers.onSetPlace);
  if (place) row.appendChild(place);

  // モードに関わらず同じボタンが同じように 3 段階を回る（cycleCell 参照）
  const checks = el("div", "pkitem__checks");
  for (const member of ["a", "b"]) {
    checks.appendChild(cycleCell(item, member, data.members[member], handlers.onCycle));
  }
  row.appendChild(checks);

  if (editing) {
    const acts = el("div", "pkitem__acts");
    // ドラッグが使えない環境のために ↑↓ を常に併設する（設計書 §7.3）
    const up = iconButton("rowbtn", "i-arrow-right", "1 つ上へ");
    up.style.transform = "rotate(-90deg)";
    up.dataset.focusKey = itemFocusKey(item.id, "up");
    up.addEventListener("click", () => handlers.onMoveItem?.(item.id, -1));
    const down = iconButton("rowbtn", "i-arrow-right", "1 つ下へ");
    down.style.transform = "rotate(90deg)";
    down.dataset.focusKey = itemFocusKey(item.id, "down");
    down.addEventListener("click", () => handlers.onMoveItem?.(item.id, +1));
    acts.appendChild(up);
    acts.appendChild(down);
    const del = armedIconButton({
      cls: "rowbtn rowbtn--del",
      armedCls: "rowbtn rowbtn--confirm",
      iconId: "i-x",
      label: `${item.name} を削除`,
      armedLabel: "もう一度で削除",
      onConfirm: () => handlers.onDeleteItem?.(item.id),
    });
    del.dataset.focusKey = itemFocusKey(item.id, "del");
    acts.appendChild(del);
    row.appendChild(acts);
  }

  return row;
}

function groupBlock(group, data, editing, handlers) {
  const block = el("section", "pkgroup");
  block.dataset.groupId = group.id;

  const head = el("div", "pkgroup__head");
  if (group.icon) {
    const mark = el("span", "pkgroup__ico");
    mark.innerHTML = icon(group.icon, "ico--sm");
    mark.setAttribute("aria-hidden", "true");
    head.appendChild(mark);
  }

  if (editing) {
    const name = document.createElement("input");
    name.className = "inp inp--group";
    name.type = "text";
    name.value = group.name;
    name.setAttribute("aria-label", "区分名");
    name.dataset.focusKey = groupFocusKey(group.id, "name");
    name.addEventListener("change", () =>
      handlers.onRenameGroup?.(group.id, { name: name.value })
    );
    head.appendChild(name);
  } else {
    head.appendChild(el("h2", "pkgroup__name", group.name));
  }

  // groupProgressOf() は na の人を除いた残り全員がチェック済みかで数える
  // （packing-data.js）。ここで `i.a && i.b` を書き写すと、na を無視した
  // ままの分母に逆戻りする
  const { done, total } = groupProgressOf(group);
  head.appendChild(el("p", "pkgroup__count", `${done} / ${total}`));

  if (editing) {
    const acts = el("div", "pkgroup__acts");
    const up = iconButton("rowbtn", "i-arrow-right", "この区分を 1 つ上へ");
    up.style.transform = "rotate(-90deg)";
    up.dataset.focusKey = groupFocusKey(group.id, "up");
    up.addEventListener("click", () => handlers.onMoveGroup?.(group.id, -1));
    const down = iconButton("rowbtn", "i-arrow-right", "この区分を 1 つ下へ");
    down.style.transform = "rotate(90deg)";
    down.dataset.focusKey = groupFocusKey(group.id, "down");
    down.addEventListener("click", () => handlers.onMoveGroup?.(group.id, +1));
    acts.appendChild(up);
    acts.appendChild(down);
    const del = armedIconButton({
      cls: "rowbtn rowbtn--del",
      armedCls: "rowbtn rowbtn--confirm",
      iconId: "i-x",
      // 中身の数を出す（設計書 §7.3）。何件消えるのかを見ずに押させない
      label: `${group.name} を削除`,
      armedLabel: `もう一度で ${group.items.length} 件ごと削除`,
      onConfirm: () => handlers.onDeleteGroup?.(group.id),
    });
    del.dataset.focusKey = groupFocusKey(group.id, "del");
    acts.appendChild(del);
    head.appendChild(acts);
  }

  block.appendChild(head);

  const list = el("ul", "pkitems");
  // 空の区分にもドラッグで項目を落とせるようにするための目印（packing-drag.js が読む）
  list.dataset.itemList = "1";
  for (const item of group.items) {
    list.appendChild(itemRow(item, data, editing, handlers));
  }
  block.appendChild(list);

  if (editing) {
    const add = el("button", "tbtn");
    add.type = "button";
    add.innerHTML = icon("i-plus", "ico--sm");
    add.appendChild(el("span", null, "項目を追加"));
    add.dataset.focusKey = groupFocusKey(group.id, "add");
    add.addEventListener("click", () => handlers.onAddItem?.(group.id));
    block.appendChild(add);
  }

  return block;
}

/**
 * 表全体。
 *
 * @param {object} args
 * @param {HTMLElement} args.mount 差し替え先
 * @param {object} args.data 持ち物データ
 * @param {boolean} args.editing 編集モードか
 * @param {object} args.handlers 行の操作。すべて省略可（テストが空で呼ぶ）
 */
export function renderTable({ mount, data, editing, handlers = {} }) {
  if (data.groups.length === 0) {
    const empty = el(
      "p",
      "body",
      editing
        ? "まだ何もありません。「区分を追加」から始めてください。"
        : "まだ何もありません。「リストを編集」から追加できます。"
    );
    mount.replaceChildren(empty);
    return;
  }
  mount.replaceChildren(
    ...data.groups.map((group) => groupBlock(group, data, editing, handlers))
  );
}
