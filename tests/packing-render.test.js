/**
 * packing-render.js の描画テスト。
 *
 * renderers.test.js と同じ最小 DOM スタブを土台に、クリックイベントを発火できる
 * だけの機能を足してある（addEventListener でリスナーを記録し、dispatch で呼ぶ）。
 * 元のスタブの持つ性質（innerHTML / textContent の分離記録）はそのまま。
 * 狙いは「イベント由来の文字列が innerHTML に流れていないこと」の検査
 * （このページはリポジトリ書き込み権限を持つトークンを抱えているため、CLAUDE.md の規約）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderProgress, renderTable } from "../assets/js/packing-render.js";
import { PACKING } from "./fixtures/packing.js";

/* renderers.test.js と同じ最小スタブを土台に、setAttribute の記録と
   addEventListener → dispatch を足したもの。document.createElement だけを備え、
   innerHTML に入った文字列と textContent に入った文字列を別々に記録する。 */
function stubDocument() {
  const htmlSink = [];
  const textSink = [];
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      style: {},
      attrs: {},
      listeners: {},
      // NOTE (review finding, not a defect today): unlike a real DOM, this setter
      // does not clear `.children`. Every innerHTML assignment in packing-render.js
      // happens *before* any appendChild on the same node, which is safe here and
      // would also be safe in a real DOM (assigning innerHTML after children exist
      // is what nukes them there). But if a future edit ever assigns innerHTML
      // *after* appendChild on the same node, this stub will not catch the bug —
      // .children keeps the appended nodes while a real browser would discard them.
      set innerHTML(v) {
        htmlSink.push(String(v));
        this._html = String(v);
      },
      get innerHTML() {
        return this._html ?? "";
      },
      set textContent(v) {
        textSink.push(String(v));
        this._text = String(v);
      },
      get textContent() {
        return this._text ?? "";
      },
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      getAttribute(name) {
        return this.attrs[name] ?? null;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      replaceChildren(...kids) {
        this.children = kids;
      },
      addEventListener(type, fn) {
        (this.listeners[type] ??= []).push(fn);
      },
      dispatch(type, payload = {}) {
        for (const fn of this.listeners[type] ?? []) fn({ target: this, ...payload });
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    return node;
  };
  globalThis.document = { createElement: make };
  return { htmlSink, textSink, make };
}

/** mount 以下を辿って条件に合う最初のノードを返す。 */
function findFirst(node, pred) {
  if (pred(node)) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, pred);
    if (found) return found;
  }
  return null;
}

/** mount 以下を辿って条件に合う全ノードを返す。 */
function findAll(node, pred) {
  const out = [];
  const walk = (n) => {
    if (pred(n)) out.push(n);
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return out;
}

test("進捗は 2 人分をそれぞれ出す", () => {
  const { make, textSink } = stubDocument();
  const mount = make("div");
  renderProgress({ mount, data: PACKING });
  const text = textSink.join("\n");
  assert.match(text, /雄一/);
  assert.match(text, /朱汰/);
  assert.match(text, /2\s*\/\s*4/);
});

test("項目が 0 件でも落ちない（ゼロ除算）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const empty = { members: { a: "雄一", b: "朱汰" }, groups: [] };
  assert.doesNotThrow(() => renderProgress({ mount, data: empty }));
});

test("total が 0 のとき進捗バーの幅は 0%（ゼロ除算の実際の値を見る）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const empty = { members: { a: "雄一", b: "朱汰" }, groups: [] };
  renderProgress({ mount, data: empty });
  const fills = findAll(mount, (n) => n.className === "pkprog__fill");
  assert.deepEqual(
    fills.map((f) => f.style.width),
    ["0%", "0%"]
  );
});

test("項目名とメモは textContent に入り、innerHTML には出ない", () => {
  const { make, htmlSink, textSink } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [
      {
        id: "g-1",
        name: "<script>alert(1)</script>",
        icon: "i-note",
        items: [
          { id: "it-1", name: "<img onerror=x>", note: "\"><b>", a: false, b: false },
        ],
      },
    ],
  };
  renderTable({ mount, data, editing: false, handlers: {} });

  const html = htmlSink.join("\n");
  const text = textSink.join("\n");
  assert.ok(text.includes("<img onerror=x>"), "項目名が textContent に入っていません");
  assert.ok(text.includes('"><b>'), "メモが textContent に入っていません");
  assert.ok(!html.includes("onerror"), "項目名が innerHTML に流れています");
  assert.ok(!html.includes("alert(1)"), "区分名が innerHTML に流れています");
});

test("行は data-item-id を持つ（ドラッグが読む）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: true, handlers: {} });

  const ids = findAll(mount, (n) => n.dataset?.itemId).map((n) => n.dataset.itemId);
  assert.deepEqual(ids, ["passport", "cash", "insurance", "swimwear"]);
});

/*
 * Review finding: the test above's title used to claim it also covered
 * data-group-id, but its body never read it — packing-drag.js:92
 * (`querySelectorAll("[data-group-id]")`, used for group reordering) had no
 * assertion behind it. Split into its own honestly-named test.
 */
test("区分は data-group-id を持つ（packing-drag.js の区分並べ替えが読む）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: true, handlers: {} });

  const ids = findAll(mount, (n) => n.dataset?.groupId).map((n) => n.dataset.groupId);
  assert.deepEqual(ids, ["g-valuables", "g-clothes", "g-empty"]);
});

/*
 * Review finding: also untested. packing-drag.js:149 does
 * `closest("[data-item-list]")` to find the empty-group drop target — without
 * this marker, dragging an item onto an empty group silently fails to find a
 * drop zone.
 */
test("項目リストの ul は data-item-list を持つ（空の区分にもドラッグで落とせる目印）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: true, handlers: {} });

  const lists = findAll(mount, (n) => n.dataset?.itemList);
  // PACKING は区分が 3 つ（g-empty も含む）。空の区分にも ul 自体は必ず出る
  assert.equal(lists.length, 3);
  for (const list of lists) {
    assert.equal(list.dataset.itemList, "1");
  }
});

test("読み取りモードでは編集用のボタンを組み立てない", () => {
  const { make } = stubDocument();
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });

  const editing = make("div");
  renderTable({ mount: editing, data: PACKING, editing: true, handlers: {} });

  const count = (node) => {
    let n = node.tagName === "BUTTON" ? 1 : 0;
    for (const child of node.children ?? []) n += count(child);
    return n;
  };
  assert.ok(
    count(editing) > count(readOnly),
    "編集モードでボタンが増えていません（editing が効いていない）"
  );
});

/* ── ここから下は mandatory self-check で足したテスト ── */

/*
 * count(editing) > count(readOnly) という「大小」の比較は、編集専用ボタンの
 * 一部だけを editing ガードの外に出す不備を見逃す ── 読み取りモードのボタン数が
 * 0 から 2 に増えても、編集モードには他の編集専用ボタン（削除・区分の並べ替え等）が
 * まだ残っていれば「編集 > 読み取り」は依然として真になる。
 * 自己点検でこれを実際に確かめた（項目の ↑↓ ボタンのガードを外しても
 * 元の大小比較テストは落ちなかった）ので、読み取りモードのボタン数が
 * 厳密に 0 であることを見る、より強いテストに置き換える。
 */
test("読み取りモードにはボタンが 1 つも無い（大小比較では見逃す不備を拾う）", () => {
  const { make } = stubDocument();
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });
  const buttons = findAll(readOnly, (n) => n.tagName === "BUTTON");
  assert.equal(buttons.length, 0);
});

test("読み取りモードでは項目名・区分名・メモの入力欄を作らない（チェックボックスの分だけ INPUT が残る）", () => {
  const { make } = stubDocument();
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });
  const inputCount = findAll(readOnly, (n) => n.tagName === "INPUT").length;
  // PACKING は 4 項目 × 2 人分のチェックボックスのみ
  assert.equal(inputCount, 8);
});

test("編集モードでは項目名・区分名・メモの入力欄が増える", () => {
  const { make } = stubDocument();
  const editing = make("div");
  renderTable({ mount: editing, data: PACKING, editing: true, handlers: {} });
  const inputCount = findAll(editing, (n) => n.tagName === "INPUT").length;
  // チェックボックス 8 + 項目名 4 + メモ 4 + 区分名 3 = 19
  assert.equal(inputCount, 19);
});

test("読み取りモードではドラッグハンドルを組み立てない（data-drag-handle が 0 件）", () => {
  const { make } = stubDocument();
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });
  const handles = findAll(readOnly, (n) => n.dataset?.dragHandle);
  assert.equal(handles.length, 0);
});

test("編集モードでは項目ごとにドラッグハンドルが 1 つずつ出る", () => {
  const { make } = stubDocument();
  const editing = make("div");
  renderTable({ mount: editing, data: PACKING, editing: true, handlers: {} });
  const handles = findAll(editing, (n) => n.dataset?.dragHandle);
  assert.equal(handles.length, 4); // PACKING は 4 項目
});

test("区分の icon が falsy なら pkgroup__ico を作らず、例外にもならない", () => {
  const { make, htmlSink } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [{ id: "g-noicon", name: "アイコン無し", icon: "", items: [] }],
  };
  assert.doesNotThrow(() => renderTable({ mount, data, editing: false, handlers: {} }));
  const icoNodes = findAll(mount, (n) => n.className === "pkgroup__ico");
  assert.equal(icoNodes.length, 0);
  assert.ok(!htmlSink.join("\n").includes("#i-"), "アイコンが無いのに描画されています");
});

test("note が空文字の項目は pkitem__note を作らない（読み取りモード）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: false, handlers: {} });
  const notes = findAll(mount, (n) => n.className === "pkitem__note").map((n) => n.textContent);
  // fixture のうち note を持つのは passport（"残存6か月以上"）と swimwear（"パタヤ用"）。
  // cash / insurance は note: "" で、pkitem__note を作らないはず
  assert.deepEqual(notes, ["残存6か月以上", "パタヤ用"]);
});

test("groups が空のとき、読み取りモードと編集モードでプレースホルダの文言が違う", () => {
  const { make } = stubDocument();
  const empty = { members: { a: "雄一", b: "朱汰" }, groups: [] };

  const readOnly = make("div");
  renderTable({ mount: readOnly, data: empty, editing: false, handlers: {} });
  const readText = readOnly.children[0]?.textContent;

  const editing = make("div");
  renderTable({ mount: editing, data: empty, editing: true, handlers: {} });
  const editText = editing.children[0]?.textContent;

  assert.notEqual(readText, editText);
  assert.match(readText, /リストを編集/);
  assert.match(editText, /区分を追加/);
});

test("handlers を渡さなくても renderTable は落ちない（handlers 省略可）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  assert.doesNotThrow(() => renderTable({ mount, data: PACKING, editing: true }));
});

test("行の操作ハンドラも個別に省略できる（onToggle などが無くても押せる）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: true, handlers: {} });
  const checkbox = findFirst(mount, (n) => n.tagName === "INPUT" && n.type === "checkbox");
  assert.doesNotThrow(() => checkbox.dispatch("change"));
});

test("項目の削除ボタンは 1 回目で武装し、2 回目で onDeleteItem(itemId) を呼ぶ", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: true,
    handlers: { onDeleteItem: (id) => calls.push(id) },
  });

  const delBtn = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.attrs["aria-label"] === "パスポート を削除"
  );
  assert.ok(delBtn, "削除ボタンが見つかりません");

  delBtn.dispatch("click");
  assert.deepEqual(calls, [], "1 回目のクリックで即削除しています");
  assert.equal(delBtn.attrs["aria-label"], "もう一度で削除");

  delBtn.dispatch("click");
  assert.deepEqual(calls, ["passport"], "2 回目のクリックで onDeleteItem が呼ばれていません");
});

test("区分の削除ボタンは何件消えるかを武装ラベルで言う", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: true,
    handlers: { onDeleteGroup: (id) => calls.push(id) },
  });

  // g-valuables は 3 件
  const delBtn = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.attrs["aria-label"] === "貴重品・書類 を削除"
  );
  assert.ok(delBtn, "区分の削除ボタンが見つかりません");

  delBtn.dispatch("click");
  assert.equal(delBtn.attrs["aria-label"], "もう一度で 3 件ごと削除");
  assert.deepEqual(calls, []);

  delBtn.dispatch("click");
  assert.deepEqual(calls, ["g-valuables"]);
});

test("チェックの印は icon('i-check') の <use> ではなく生の SVG（stroke-dashoffset のアニメーションが効くもの）", () => {
  const { make, htmlSink } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: false, handlers: {} });
  const html = htmlSink.join("\n");
  assert.match(html, /<path d="m4\.5 12\.6 5\.2 5\.2L19\.5 6\.6"\/>/);
  assert.ok(!html.includes("#i-check"), "icon('i-check') の <use> 参照が使われています");
});

test("チェックボックスのマークアップは label.switch > span.check > (input + span.check__box) の隣接兄弟", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: false, handlers: {} });

  const switchLabel = findFirst(mount, (n) => n.className === "switch");
  assert.ok(switchLabel, "label.switch が見つかりません");
  const check = switchLabel.children.find((c) => c.className === "check");
  assert.ok(check, "span.check が見つかりません");
  assert.equal(check.children[0].type, "checkbox", "input が check の最初の子ではありません");
  assert.equal(
    check.children[1].className,
    "check__box",
    "input の直後（隣接兄弟）が check__box ではありません"
  );
});

test("チェックを入れると onToggle(itemId, member, checked) が呼ばれる", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: false,
    handlers: { onToggle: (id, member, checked) => calls.push([id, member, checked]) },
  });

  const checkbox = findFirst(mount, (n) => n.tagName === "INPUT" && n.type === "checkbox");
  checkbox.checked = true;
  checkbox.dispatch("change");
  assert.deepEqual(calls, [["passport", "a", true]]);
});

/*
 * Review finding: onMoveItem / onMoveGroup / onRenameItem / onRenameGroup /
 * onAddItem were wired in packing-render.js but never dispatched in a test.
 * Concretely undetectable before this: swapping the -1/+1 delta between the
 * ↑ and ↓ buttons, or changing the { name } / { note } patch shape passed to
 * onRenameItem. Task 10 wires these to real data mutations, so a swapped
 * delta there would move rows the wrong way with nothing here to say so.
 */

test("項目の ↑ ボタンは onMoveItem(itemId, -1) を、↓ ボタンは onMoveItem(itemId, +1) を呼ぶ", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: true,
    handlers: { onMoveItem: (id, delta) => calls.push([id, delta]) },
  });

  // 深さ優先の描画順で最初に出る「1 つ上へ」「1 つ下へ」は先頭項目（passport）のもの
  const up = findFirst(mount, (n) => n.tagName === "BUTTON" && n.attrs["aria-label"] === "1 つ上へ");
  const down = findFirst(mount, (n) => n.tagName === "BUTTON" && n.attrs["aria-label"] === "1 つ下へ");
  assert.ok(up && down, "項目の ↑↓ ボタンが見つかりません");

  up.dispatch("click");
  down.dispatch("click");
  assert.deepEqual(calls, [
    ["passport", -1],
    ["passport", 1],
  ]);
});

test("区分の ↑ ボタンは onMoveGroup(groupId, -1) を、↓ ボタンは onMoveGroup(groupId, +1) を呼ぶ", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: true,
    handlers: { onMoveGroup: (id, delta) => calls.push([id, delta]) },
  });

  const up = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.attrs["aria-label"] === "この区分を 1 つ上へ"
  );
  const down = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.attrs["aria-label"] === "この区分を 1 つ下へ"
  );
  assert.ok(up && down, "区分の ↑↓ ボタンが見つかりません");

  up.dispatch("click");
  down.dispatch("click");
  assert.deepEqual(calls, [
    ["g-valuables", -1],
    ["g-valuables", 1],
  ]);
});

test("項目名の入力欄は change で onRenameItem(itemId, { name }) を呼ぶ", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: true,
    handlers: { onRenameItem: (id, patch) => calls.push([id, patch]) },
  });

  const nameInput = findFirst(
    mount,
    (n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "項目名"
  );
  assert.ok(nameInput, "項目名の入力欄が見つかりません");
  nameInput.value = "新しいパスポート";
  nameInput.dispatch("change");
  assert.deepEqual(calls, [["passport", { name: "新しいパスポート" }]]);
});

test("メモの入力欄は change で onRenameItem(itemId, { note }) を呼ぶ", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: true,
    handlers: { onRenameItem: (id, patch) => calls.push([id, patch]) },
  });

  const noteInput = findFirst(
    mount,
    (n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "メモ"
  );
  assert.ok(noteInput, "メモの入力欄が見つかりません");
  noteInput.value = "更新後のメモ";
  noteInput.dispatch("change");
  assert.deepEqual(calls, [["passport", { note: "更新後のメモ" }]]);
});

test("区分名の入力欄は change で onRenameGroup(groupId, { name }) を呼ぶ", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: true,
    handlers: { onRenameGroup: (id, patch) => calls.push([id, patch]) },
  });

  const groupNameInput = findFirst(
    mount,
    (n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "区分名"
  );
  assert.ok(groupNameInput, "区分名の入力欄が見つかりません");
  groupNameInput.value = "貴重品";
  groupNameInput.dispatch("change");
  assert.deepEqual(calls, [["g-valuables", { name: "貴重品" }]]);
});

test("「項目を追加」ボタンは onAddItem(groupId) を呼ぶ", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: true,
    handlers: { onAddItem: (id) => calls.push(id) },
  });

  const addBtn = findFirst(mount, (n) => n.tagName === "BUTTON" && n.className === "tbtn");
  assert.ok(addBtn, "項目を追加ボタンが見つかりません");
  addBtn.dispatch("click");
  assert.deepEqual(calls, ["g-valuables"]);
});

test("区分ヘッダーの達成数は a かつ b が true の項目数（progressOf とは別の集計）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: false, handlers: {} });
  const counts = findAll(mount, (n) => n.className === "pkgroup__count").map((n) => n.textContent);
  // g-valuables: passport(true,true) だけが両方 true → 1/3
  // g-clothes: swimwear(false,true) → 0/1
  // g-empty: 0/0
  assert.deepEqual(counts, ["1 / 3", "0 / 1", "0 / 0"]);
});
