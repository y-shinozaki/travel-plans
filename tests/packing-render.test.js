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
      // 実 DOM と同じく、代入は既存の子要素を捨てる。**この 1 行を消さないこと。**
      // 消すと「先に appendChild して、あとから innerHTML で別の断片を差し込む」
      // 改変が、スタブ上では何も気付かれずに通り、実ブラウザでだけ壊れる
      // （実 DOM では innerHTML への代入が子要素を消すため）。設計書 §13。
      set innerHTML(v) {
        htmlSink.push(String(v));
        this._html = String(v);
        this.children.length = 0;
      },
      get innerHTML() {
        return this._html ?? "";
      },
      // textContent も実 DOM では子要素を消す。理由は innerHTML と同じ
      set textContent(v) {
        textSink.push(String(v));
        this._text = String(v);
        this.children.length = 0;
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
test("読み取りモードには編集専用のボタンが 1 つも無い（大小比較では見逃す不備を拾う）", () => {
  const { make } = stubDocument();
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });
  // 人ごとの状態ボタン（pkcycle__box）はモードに関わらず出る、唯一の例外
  // （plans/packing-not-applicable.md「描画」）。それ以外のボタン（削除・
  // 並べ替え・追加など）は読み取りモードに 1 つも無いこと
  const buttons = findAll(
    readOnly,
    (n) => n.tagName === "BUTTON" && !(n.className ?? "").startsWith("pkcycle__box")
  );
  assert.equal(buttons.length, 0);
});

test("読み取りモードでは項目名・区分名・メモの入力欄を作らない（INPUT は 1 つも無い）", () => {
  const { make } = stubDocument();
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });
  // 人ごとの欄は <input type="checkbox"> ではなく <button> になった
  // （3 段階を回すコントロール。plans/packing-not-applicable.md「描画」）
  const inputCount = findAll(readOnly, (n) => n.tagName === "INPUT").length;
  assert.equal(inputCount, 0);
});

test("編集モードでは項目名・区分名・メモの入力欄が増える", () => {
  const { make } = stubDocument();
  const editing = make("div");
  renderTable({ mount: editing, data: PACKING, editing: true, handlers: {} });
  const inputCount = findAll(editing, (n) => n.tagName === "INPUT").length;
  // 項目名 4 + メモ 4 + 区分名 3 = 11。人ごとの欄はどちらのモードでも
  // <button> なので INPUT には現れない
  assert.equal(inputCount, 11);
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

test("行の操作ハンドラも個別に省略できる（onCycle などが無くても押せる）", () => {
  const { make } = stubDocument();
  // 人ごとの欄はモードに関わらず同じボタン。両方のモードで押せることを見る
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });
  const cycleReadOnly = findFirst(readOnly, (n) => n.dataset?.focusKey === "item:passport:check:a");
  assert.doesNotThrow(() => cycleReadOnly.dispatch("click"));

  const editing = make("div");
  renderTable({ mount: editing, data: PACKING, editing: true, handlers: {} });
  const cycleEditing = findFirst(editing, (n) => n.dataset?.focusKey === "item:passport:check:a");
  assert.doesNotThrow(() => cycleEditing.dispatch("click"));
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

test("人ごとの欄は span.pkcycle > (button.pkcycle__box, span) の並び", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: false, handlers: {} });

  const wrap = findFirst(mount, (n) => n.className === "pkcycle");
  assert.ok(wrap, "span.pkcycle が見つかりません");
  assert.equal(wrap.children.length, 2, "ボタンと名前の 2 要素構成ではありません");
  const [button, name] = wrap.children;
  assert.equal(button.tagName, "BUTTON", "1 つ目の子が button ではありません");
  assert.match(button.className, /^pkcycle__box/, "button に pkcycle__box が付いていません");
  assert.equal(name.tagName, "SPAN", "2 つ目の子が名前の span ではありません");
  assert.equal(name.textContent, "雄一", "名前が入っていません");
});

test("押すたびに onCycle(itemId, member) が呼ばれる", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: PACKING,
    editing: false,
    handlers: { onCycle: (id, member) => calls.push([id, member]) },
  });

  // passport の a は checked（fixture）。押すと次の状態（不要）へ、という
  // 判断は cycleMember() の役目で、ここではボタンが itemId と member を
  // そのまま渡すことだけを見る
  const button = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.dataset?.focusKey === "item:passport:check:a"
  );
  assert.ok(button, "人ごとの欄のボタンが見つかりません");
  button.dispatch("click");
  assert.deepEqual(calls, [["passport", "a"]]);
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

test("区分ヘッダーの達成数は groupProgressOf() の結果をそのまま出す（progressOf とは別の集計）", () => {
  // PACKING フィクスチャに na を持つ項目は無いので、groupProgressOf() の結果は
  // 「a かつ b が true」と一致する。na がある場合の分岐は packing-data.test.js の
  // groupProgressOf() のテストで見る（ここで書き写すと groupProgressOf() の
  // 判定規則がこのテストにも複製される）
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: false, handlers: {} });
  const counts = findAll(mount, (n) => n.className === "pkgroup__count").map((n) => n.textContent);
  // g-valuables: passport(true,true) だけが両方 true → 1/3
  // g-clothes: swimwear(false,true) → 0/1
  // g-empty: 0/0
  assert.deepEqual(counts, ["1 / 3", "0 / 1", "0 / 0"]);
});

/*
 * Review finding (Task 10 の再レビュー): 再描画のたびに mount.replaceChildren() が
 * 全ノードを作り直すので、フォーカスしていた要素はもう文書にいない。
 * packing.js がフォーカスを戻すには、id から作った安定したキーが要る ──
 * 位置から作ると、並べ替えたその瞬間にキーが変わり、何のためのキーか分からなくなる。
 * 以下の 3 本はそれぞれ別の壊れ方を拾う: キーが付いていない／キーが重複する／
 * キーが位置に依存してしまう（並べ替えると変わる）。
 */

test("項目・区分の操作コントロールに data-focus-key が付く（id から作る）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: true, handlers: {} });

  const keys = new Set(findAll(mount, (n) => n.dataset?.focusKey).map((n) => n.dataset.focusKey));

  // 項目（passport）まわり
  assert.ok(keys.has("item:passport:up"), "項目の ↑ ボタンにキーが無い");
  assert.ok(keys.has("item:passport:down"), "項目の ↓ ボタンにキーが無い");
  assert.ok(keys.has("item:passport:del"), "項目の削除ボタンにキーが無い");
  assert.ok(keys.has("item:passport:name"), "項目名の入力欄にキーが無い");
  assert.ok(keys.has("item:passport:note"), "メモの入力欄にキーが無い");
  // 人ごとの欄はモードに関わらず同じボタン・同じキー（check:a / check:b）
  assert.ok(keys.has("item:passport:check:a"), "人ごとの欄のボタン(a)にキーが無い");
  assert.ok(keys.has("item:passport:check:b"), "人ごとの欄のボタン(b)にキーが無い");

  // 区分（g-valuables）まわり
  assert.ok(keys.has("group:g-valuables:name"), "区分名の入力欄にキーが無い");
  assert.ok(keys.has("group:g-valuables:up"), "区分の ↑ ボタンにキーが無い");
  assert.ok(keys.has("group:g-valuables:down"), "区分の ↓ ボタンにキーが無い");
  assert.ok(keys.has("group:g-valuables:del"), "区分の削除ボタンにキーが無い");
  assert.ok(keys.has("group:g-valuables:add"), "「項目を追加」ボタンにキーが無い");

  // 通常モードでも同じキーで引けること（モードで役割を変えないため）
  const readOnly = make("div");
  renderTable({ mount: readOnly, data: PACKING, editing: false, handlers: {} });
  const readKeys = new Set(
    findAll(readOnly, (n) => n.dataset?.focusKey).map((n) => n.dataset.focusKey)
  );
  assert.ok(readKeys.has("item:passport:check:a"), "人ごとの欄のボタン(a)にキーが無い");
  assert.ok(readKeys.has("item:passport:check:b"), "人ごとの欄のボタン(b)にキーが無い");
});

test("読み取りモードでは data-focus-key を持つ要素が 1 つも無い（操作コントロール自体が無い）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: false, handlers: {} });
  // チェックボックスだけは読み取りモードでも押せる（設計書 §7.3）ので、
  // 「無い」ではなく「チェックボックスの分だけある」を見る
  const keys = findAll(mount, (n) => n.dataset?.focusKey).map((n) => n.dataset.focusKey);
  assert.equal(keys.length, 8); // 4 項目 × 2 人分
  assert.ok(keys.every((k) => /^item:.+:check:[ab]$/.test(k)));
});

test("data-focus-key は 1 回の描画内で重複しない", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: PACKING, editing: true, handlers: {} });
  const keys = findAll(mount, (n) => n.dataset?.focusKey).map((n) => n.dataset.focusKey);
  assert.ok(keys.length > 0, "focusKey を持つ要素が 1 つも無い（テストが空振りしている）");
  assert.equal(new Set(keys).size, keys.length, "同じ focusKey を持つ要素が複数ある");
});

test("data-focus-key は位置ではなく id から作る（並べ替えても同じ項目なら同じキー）", () => {
  const { make: make1 } = stubDocument();
  const mount1 = make1("div");
  renderTable({ mount: mount1, data: PACKING, editing: true, handlers: {} });
  const before = findFirst(
    mount1,
    (n) => n.dataset?.focusKey === "item:passport:up"
  );
  assert.ok(before, "並べ替え前に item:passport:up が見つからない");

  // g-valuables の中で passport を先頭から末尾へ動かす（＝ DOM 上の位置が変わる）。
  // キーが位置から作られていれば、この並べ替えだけでキーが変わってしまうはず
  const reordered = {
    ...PACKING,
    groups: PACKING.groups.map((g) =>
      g.id === "g-valuables" ? { ...g, items: [...g.items.slice(1), g.items[0]] } : g
    ),
  };

  const { make: make2 } = stubDocument();
  const mount2 = make2("div");
  renderTable({ mount: mount2, data: reordered, editing: true, handlers: {} });
  const after = findFirst(
    mount2,
    (n) => n.dataset?.focusKey === "item:passport:up"
  );
  assert.ok(after, "並べ替え後に item:passport:up が見つからない（キーが位置依存になっている）");
});

/* ── 入れる場所（where）── */

/** where を仕込んだフィクスチャの複製。 */
const withPlaces = () => {
  const d = JSON.parse(JSON.stringify(PACKING));
  d.groups[0].items[0].where = "hand"; // passport
  d.groups[0].items[1].where = "checked"; // cash
  // insurance は未設定のまま（ラベルを出さないことの検査に使う）
  return d;
};

test("読み取りモードでは、設定された入れる場所がラベルとして出る", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: withPlaces(), editing: false, handlers: {} });
  const chips = findAll(mount, (n) => n.className === "pkplace");
  assert.deepEqual(
    chips.map((c) => c.textContent),
    ["手持ち", "スーツケース"],
    "設定した 2 件のラベルが順に出ていません"
  );
});

test("読み取りモードで未設定の項目にはラベルを作らない（「未設定」と書かない）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  // 4 項目のうち where を持つのは 2 件だけ
  renderTable({ mount, data: withPlaces(), editing: false, handlers: {} });
  assert.equal(findAll(mount, (n) => n.className === "pkplace").length, 2);
  assert.equal(
    findAll(mount, (n) => n.textContent === "未設定").length,
    0,
    "読み取りモードに「未設定」の文字を出しています"
  );
});

test("読み取りモードでは選択欄（select）を作らない", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: withPlaces(), editing: false, handlers: {} });
  assert.equal(findAll(mount, (n) => n.tagName === "SELECT").length, 0);
});

test("編集モードでは項目ごとに選択欄が 1 つ出て、未設定＋既知の場所が並ぶ", async () => {
  const { PLACE_META } = await import("../assets/js/packing-data.js");
  const { make } = stubDocument();
  const mount = make("div");
  const data = withPlaces();
  renderTable({ mount, data, editing: true, handlers: {} });

  const selects = findAll(mount, (n) => n.tagName === "SELECT");
  const itemCount = data.groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(selects.length, itemCount, "選択欄の数が項目数と合いません");

  // 選択肢は「未設定」＋ PLACE_META のキー。一覧を書き写さず定義から導く
  const options = selects[0].children.map((o) => o.textContent);
  assert.deepEqual(options, ["未設定", ...Object.values(PLACE_META).map((p) => p.label)]);
});

test("編集モードの選択欄には、その項目の現在値が入っている", () => {
  const { make } = stubDocument();
  const mount = make("div");
  renderTable({ mount, data: withPlaces(), editing: true, handlers: {} });
  const selects = findAll(mount, (n) => n.tagName === "SELECT");
  assert.equal(selects[0].value, "hand", "1 件目に現在値が入っていません");
  assert.equal(selects[1].value, "checked", "2 件目に現在値が入っていません");
  assert.equal(selects[2].value, "", "未設定の項目が空になっていません");
});

test("選択欄を変えると onSetPlace(itemId, where) が呼ばれる", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const calls = [];
  renderTable({
    mount,
    data: withPlaces(),
    editing: true,
    handlers: { onSetPlace: (id, where) => calls.push([id, where]) },
  });
  const select = findAll(mount, (n) => n.tagName === "SELECT")[0];
  select.value = "cabin";
  select.dispatch("change");
  assert.deepEqual(calls, [["passport", "cabin"]]);

  // 未設定へ戻す経路も通ること（空文字を渡す）
  select.value = "";
  select.dispatch("change");
  assert.deepEqual(calls[1], ["passport", ""]);
});

test("選択欄の focusKey は id 由来（並べ替えても変わらない）", () => {
  const { make } = stubDocument();
  const keyOf = (data) => {
    const mount = make("div");
    renderTable({ mount, data, editing: true, handlers: {} });
    return findFirst(mount, (n) => n.dataset?.itemId === "passport")
      ? findAll(mount, (n) => n.dataset?.focusKey === "item:passport:place").length
      : 0;
  };
  assert.equal(keyOf(withPlaces()), 1, "選択欄に focusKey がありません");

  // 並び順を変えても同じキーで引ける（位置由来なら壊れる）
  const moved = withPlaces();
  moved.groups[0].items.reverse();
  assert.equal(keyOf(moved), 1, "並べ替えで focusKey が変わりました");
});

/* ── 人ごとの欄（ひとつのボタンが 3 段階を回る）── */

test("ブランクの状態では枠だけの四角（アイコンも「—」も無い）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [{ id: "g1", name: "貴重品", icon: "i-note", items: [
      { id: "i1", name: "カード", note: "", a: false, b: false },
    ] }],
  };
  renderTable({ mount, data, editing: false, handlers: {} });

  const button = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.dataset?.focusKey === "item:i1:check:a"
  );
  assert.ok(button, "人ごとの欄のボタンが見つかりません");
  assert.equal(button.className, "pkcycle__box", "ブランクに状態のクラスが付いています");
  assert.equal(button.attrs["aria-label"], "雄一: カード、未チェック");
  assert.equal(button.children.length, 0, "ブランクなのに中身があります");
});

test("チェック済みの状態ではチェックマークが入り、aria-label がそう言う", () => {
  const { make, htmlSink } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [{ id: "g1", name: "貴重品", icon: "i-note", items: [
      { id: "i1", name: "カード", note: "", a: true, b: false },
    ] }],
  };
  renderTable({ mount, data, editing: false, handlers: {} });

  const button = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.dataset?.focusKey === "item:i1:check:a"
  );
  assert.equal(button.className, "pkcycle__box pkcycle__box--checked");
  assert.equal(button.attrs["aria-label"], "雄一: カード、チェック済み");
  assert.match(htmlSink.join("\n"), /<path d="m4\.5 12\.6 5\.2 5\.2L19\.5 6\.6"\/>/);
});

test("不要の状態では「—」が入り、aria-label がそう言う", () => {
  const { make, textSink } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [{ id: "g1", name: "貴重品", icon: "i-note", items: [
      { id: "i1", name: "カード", note: "", a: true, b: true, na: ["b"] },
    ] }],
  };
  renderTable({ mount, data, editing: false, handlers: {} });

  const button = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.dataset?.focusKey === "item:i1:check:b"
  );
  assert.equal(button.className, "pkcycle__box pkcycle__box--na");
  assert.equal(button.attrs["aria-label"], "朱汰: カード、不要");
  assert.ok(textSink.includes("—"), "「—」が textContent に入っていません");
});

/*
 * モードで役割を変えないのが今回の設計（plans/packing-not-applicable.md
 * 「描画」── 最初の実装は通常/編集でボタンの意味が変わってしまい、書き直した）。
 * 同じデータを editing: false / true の両方で描画し、人ごとの欄（キー・クラス・
 * aria-label）が一致することを確かめる。
 */
test("モードで見た目を変えない（通常モードと編集モードで同じ状態・同じキー）", () => {
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [{ id: "g1", name: "貴重品", icon: "i-note", items: [
      { id: "i1", name: "カード", note: "", a: true, b: true, na: ["b"] },
    ] }],
  };

  const readState = (editing) => {
    const { make } = stubDocument();
    const mount = make("div");
    renderTable({ mount, data, editing, handlers: {} });
    return findAll(mount, (n) => n.dataset?.focusKey?.startsWith("item:i1:check:")).map((n) => [
      n.dataset.focusKey,
      n.className,
      n.attrs["aria-label"],
    ]);
  };

  assert.deepEqual(readState(false), readState(true));
});

test("押すと onCycle(itemId, member) が呼ばれる（モードに関わらず同じハンドラ）", () => {
  for (const editing of [false, true]) {
    const { make } = stubDocument();
    const mount = make("div");
    const calls = [];
    const data = {
      members: { a: "雄一", b: "朱汰" },
      groups: [{ id: "g1", name: "貴重品", icon: "i-note", items: [
        { id: "i1", name: "カード", note: "", a: false, b: false },
      ] }],
    };
    renderTable({ mount, data, editing, handlers: { onCycle: (...args) => calls.push(args) } });

    const button = findFirst(
      mount,
      (n) => n.tagName === "BUTTON" && n.dataset?.focusKey === "item:i1:check:a"
    );
    button.dispatch("click");
    assert.deepEqual(calls, [["i1", "a"]], `editing=${editing} で呼ばれ方が違います`);
  }
});
