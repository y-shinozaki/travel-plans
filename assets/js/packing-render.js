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
 * すべての操作コントロール（↑↓・削除・名前とメモの入力欄・チェックボックス）に
 * `dataset.focusKey` を付ける。`itemFocusKey()` / `groupFocusKey()`（focus-key.js）が
 * id から作る ── 位置から作ると、並べ替えたその瞬間に「動いた」という事実そのものでキーが変わってしまい、
 * 何のためのキーか分からなくなる。packing.js の draw() が再描画のたびに
 * `document.activeElement` のこのキーを控え、描き直したあと同じキーを持つ要素へ
 * フォーカスを戻す（event-editor.js の focusEvent と同じ考え方 ── mount.replaceChildren()
 * は毎回すべてのノードを作り直すので、押した瞬間の要素はもう文書にいない）。
 */

import { el } from "./dom.js";
import { icon } from "./icons.js";
import { progressOf, PLACE_META, PLACE_KEYS } from "./packing-data.js";
import { itemFocusKey, groupFocusKey } from "./focus-key.js";
import { iconButton, armedIconButton, CHECK_MARK } from "./row-controls.js";

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
 * チェックボックス 1 つ。**編集モードでなくても押せる**
 * （チェックを付けるのは「編集」ではなく、このページの主目的そのもの）。
 *
 * マークアップは controls.css の `.check` の契約に合わせる:
 *   label.switch > span.check > (input[type=checkbox] + span.check__box > svg) , span
 * input と .check__box が**隣接兄弟**であること（`.check input:checked + .check__box`）。
 * 間に何か挟むと、チェックしても色が変わらない。
 */
function checkCell(item, member, memberName, onToggle) {
  const label = el("label", "switch");

  const wrap = el("span", "check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = item[member] === true;
  input.setAttribute("aria-label", `${memberName}: ${item.name}`);
  input.dataset.focusKey = itemFocusKey(item.id, `check:${member}`);
  input.addEventListener("change", () => onToggle?.(item.id, member, input.checked));

  const box = el("span", "check__box");
  box.innerHTML = CHECK_MARK; // 定数のみ。値は混ぜない

  wrap.appendChild(input);
  wrap.appendChild(box);

  label.appendChild(wrap);
  label.appendChild(el("span", null, memberName));
  return label;
}

/** 不要の印。押せないことが分かるよう、ボタンにしない。 */
const NA_MARK = "—";

/**
 * 通常モードで、その人に不要な項目の欄。読むだけ。
 * チェックボックスを出さないのは、押せてしまうと「不要なのにチェックが付く」
 * 状態を作れるため（進捗からは外れているので、画面と数字が食い違う）。
 */
function naMark(item, memberName) {
  const cell = el("span", "pkitem__na", NA_MARK);
  cell.setAttribute("aria-label", `${memberName}には不要: ${item.name}`);
  return cell;
}

/**
 * 編集モードの人ごとの欄。「その人には不要」を切り替える。
 *
 * **チェックボックスとは見た目を変えること。** 同じ四角が、モードによって
 * 「詰めたか」と「要るか」を切り替えると、取り違えが進捗の分母を動かす ──
 * 画面を見ただけでは気付けない壊れ方になる（plans/packing-not-applicable.md）。
 */
function naCell(item, member, memberName, onToggleNa) {
  const notNeeded = item.na?.includes(member) === true;
  const button = el("button", notNeeded ? "napill napill--off" : "napill");
  button.type = "button";
  // 文字は textContent で入れる。値は innerHTML に混ぜない
  button.appendChild(el("span", null, notNeeded ? NA_MARK : "不要にする"));
  button.setAttribute(
    "aria-label",
    notNeeded ? `${memberName}に戻す: ${item.name}` : `${memberName}には不要にする: ${item.name}`
  );
  button.dataset.focusKey = itemFocusKey(item.id, `na:${member}`);
  button.addEventListener("click", () => onToggleNa?.(item.id, member, !notNeeded));
  return button;
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

  const checks = el("div", "pkitem__checks");
  for (const member of ["a", "b"]) {
    const memberName = data.members[member];
    if (editing) {
      // 編集モードでは「要るかどうか」を切り替える。チェックは通常モードで付ける
      checks.appendChild(naCell(item, member, memberName, handlers.onToggleNa));
    } else if (item.na?.includes(member)) {
      checks.appendChild(naMark(item, memberName));
    } else {
      checks.appendChild(checkCell(item, member, memberName, handlers.onToggle));
    }
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

  const done = group.items.filter((i) => i.a && i.b).length;
  head.appendChild(el("p", "pkgroup__count", `${done} / ${group.items.length}`));

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
