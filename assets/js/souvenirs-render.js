/**
 * お土産リストの描画。
 *
 * 通常時は読むだけの静かな見た目、「リストを編集」で編集モードへ（設計書 §7.6）。
 * **ただし「買った」のチェックだけは通常時にも押せる** ── 旅行中いちばん使う
 * 操作で、そこを編集モードの内側に置くと店先で毎回 2 手増える（設計書 §4.5）。
 *
 * 2 つのモードを別の関数にせず editing で分けるのは、行の構造を 1 か所に保つため。
 *
 * 値は必ず el()（textContent）で入れる。innerHTML に入るのは icon() が返す定数と
 * CHECK_MARK だけ。ブラウザで入力した文字列を、リポジトリ書き込み権限を持つ
 * トークンを抱えたページ自身が描画するため（CLAUDE.md の規約）。
 *
 * 操作コントロールには dataset.focusKey を付ける。souvenirs.js の draw() が
 * 再描画のたびに document.activeElement のこのキーを控え、描き直したあと同じ
 * キーを持つ要素へフォーカスを戻す（packing-render.js と同じ考え方）。
 * 書式は focus-key.js が持つ ── 両側が同じ関数を呼ばないと、片方だけ変えても
 * 例外が出ずフォーカスが静かに落ちる（設計書 §13）。
 */

import { el } from "./dom.js";
import { souvenirFocusKey } from "./focus-key.js";
import { armedIconButton, CHECK_MARK } from "./row-controls.js";
import { progressOf, shopSuggestions } from "./souvenirs-data.js";

/** 店名の候補をぶら下げる datalist の id。input の list 属性から引く。 */
const SHOP_LIST_ID = "sv-shops";

/**
 * 買った数と細いバー（設計書 §7.6）。
 * 割り算はここで行い、total が 0 のときは 0% にする ── 1 行も無い状態は実際に起こる。
 */
export function renderProgress({ mount, data }) {
  const { done, total } = progressOf(data);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const one = el("div", "svprog__one");
  one.appendChild(el("p", "svprog__name", "買った"));
  one.appendChild(el("p", "svprog__count", `${done} / ${total}`));

  const bar = el("div", "svprog__bar");
  const fill = el("div", "svprog__fill");
  fill.style.width = `${percent}%`;
  bar.appendChild(fill);
  one.appendChild(bar);

  one.setAttribute("role", "group");
  one.setAttribute("aria-label", `買った ${done} / ${total}`);
  mount.replaceChildren(one);
}

/**
 * 「買った」のチェック 1 つ。**編集モードでなくても押せる。**
 *
 * マークアップは controls.css の `.check` の契約に合わせる:
 *   label.switch > span.check > (input[type=checkbox] + span.check__box > svg)
 * input と .check__box が**隣接兄弟**であること。間に何か挟むと、
 * チェックしても色が変わらない。
 */
function boughtCell(item, onToggle) {
  const label = el("label", "switch");

  const wrap = el("span", "check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = item.bought === true;
  input.setAttribute("aria-label", `買った: ${item.name}`);
  input.dataset.focusKey = souvenirFocusKey(item.id, "bought");
  input.addEventListener("change", () => onToggle?.(item.id, input.checked));

  const box = el("span", "check__box");
  box.innerHTML = CHECK_MARK; // 定数のみ。値は混ぜない

  wrap.appendChild(input);
  wrap.appendChild(box);
  label.appendChild(wrap);
  return label;
}

/** 編集モードの入力欄 1 つ。change で patch を送る。 */
function field(item, name, { cls, placeholder, ariaLabel, list }, onEdit) {
  const input = document.createElement("input");
  input.className = cls;
  input.type = "text";
  input.value = item[name] ?? "";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", ariaLabel);
  if (list) input.setAttribute("list", list);
  input.dataset.focusKey = souvenirFocusKey(item.id, name);
  input.addEventListener("change", () => onEdit?.(item.id, { [name]: input.value }));
  return input;
}

function itemRow(item, editing, handlers) {
  const row = el("li", "svitem");
  row.dataset.itemId = item.id;

  row.appendChild(boughtCell(item, handlers.onToggle));

  const body = el("div", "svitem__body");
  if (!editing) {
    const line = el("p", "svitem__line");
    line.appendChild(el("span", "svitem__name", item.name));
    if (item.recipient) line.appendChild(el("span", "svitem__to", item.recipient));
    if (item.shop) line.appendChild(el("span", "svitem__shop", item.shop));
    body.appendChild(line);
    // メモは 2 行目。読み取りモードで縦を詰めるため、値があるときだけ出す
    if (item.note) body.appendChild(el("p", "svitem__note", item.note));
  } else {
    body.appendChild(
      field(item, "name", { cls: "inp", placeholder: "何を", ariaLabel: "何を" }, handlers.onEdit)
    );
    body.appendChild(
      field(
        item,
        "recipient",
        { cls: "inp inp--note", placeholder: "誰に", ariaLabel: "誰に" },
        handlers.onEdit
      )
    );
    body.appendChild(
      field(
        item,
        "shop",
        { cls: "inp inp--note", placeholder: "どこで", ariaLabel: "どこで", list: SHOP_LIST_ID },
        handlers.onEdit
      )
    );
    body.appendChild(
      field(item, "note", { cls: "inp inp--note", placeholder: "メモ", ariaLabel: "メモ" }, handlers.onEdit)
    );
  }
  row.appendChild(body);

  if (editing) {
    const acts = el("div", "svitem__acts");
    const del = armedIconButton({
      cls: "rowbtn rowbtn--del",
      armedCls: "rowbtn rowbtn--confirm",
      iconId: "i-x",
      label: `${item.name} を削除`,
      armedLabel: "もう一度で削除",
      onConfirm: () => handlers.onDelete?.(item.id),
    });
    del.dataset.focusKey = souvenirFocusKey(item.id, "del");
    acts.appendChild(del);
    row.appendChild(acts);
  }

  return row;
}

/**
 * 入力済みの店名の候補。編集モードのときだけ作る。
 * option の中身は value 属性に入れる（textContent ではなくても datalist は引ける）。
 */
function shopDatalist(data) {
  const list = document.createElement("datalist");
  list.id = SHOP_LIST_ID;
  for (const shop of shopSuggestions(data)) {
    const option = document.createElement("option");
    option.setAttribute("value", shop);
    list.appendChild(option);
  }
  return list;
}

/**
 * 表全体。
 *
 * @param {object} args
 * @param {HTMLElement} args.mount 差し替え先
 * @param {object} args.data お土産データ
 * @param {boolean} args.editing 編集モードか
 * @param {object} args.handlers 行の操作。すべて省略可（テストが空で呼ぶ）
 */
export function renderTable({ mount, data, editing, handlers = {} }) {
  if (data.items.length === 0) {
    const empty = el(
      "p",
      "body",
      editing
        ? "まだ何もありません。「お土産を追加」から始めてください。"
        : "まだ何もありません。「リストを編集」から追加できます。"
    );
    mount.replaceChildren(empty);
    return;
  }

  const list = el("ul", "svitems");
  for (const item of data.items) {
    list.appendChild(itemRow(item, editing, handlers));
  }

  const nodes = [list];
  if (editing) nodes.push(shopDatalist(data));
  mount.replaceChildren(...nodes);
}
