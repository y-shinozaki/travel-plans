/**
 * souvenirs-render.js の描画テスト。
 *
 * packing-render.test.js と同じ最小 DOM スタブを使う。狙いは
 * 「イベント由来の文字列が innerHTML に流れていないこと」の検査
 * （このページはリポジトリ書き込み権限を持つトークンを抱えている）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderProgress, renderTable } from "../assets/js/souvenirs-render.js";
import { SOUVENIRS } from "./fixtures/souvenirs.js";

/** packing-render.test.js と同じ最小スタブ。innerHTML と textContent を別に記録する。 */
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
      value: "",
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
      setAttribute(k, v) {
        this.attrs[k] = String(v);
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
      dispatch(type) {
        for (const fn of this.listeners[type] ?? []) fn();
      },
    };
    return node;
  };
  globalThis.document = { createElement: make };
  return { htmlSink, textSink, make };
}

const mountNode = (make) => make("div");

/** 深さ優先で全ノードを列挙する。 */
function walk(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

const findByFocusKey = (root, key) =>
  walk(root).find((n) => n.dataset?.focusKey === key);

test("renderProgress: 買った数と全体を出す", () => {
  const { make, textSink } = stubDocument();
  const mount = mountNode(make);
  renderProgress({ mount, data: SOUVENIRS });
  assert.ok(textSink.includes("1 / 4"), `進捗が出ていません: ${textSink.join(" | ")}`);
});

test("renderProgress: 空でも落ちず 0 / 0 を出す", () => {
  const { make, textSink } = stubDocument();
  const mount = mountNode(make);
  renderProgress({ mount, data: { items: [] } });
  assert.ok(textSink.includes("0 / 0"));
});

test("renderTable: 空のときは案内を出す（編集中かどうかで文言が違う）", () => {
  const { make, textSink } = stubDocument();
  const mount = mountNode(make);
  renderTable({ mount, data: { items: [] }, editing: false });
  assert.ok(textSink.some((t) => t.includes("リストを編集")), textSink.join(" | "));

  const second = stubDocument();
  const mount2 = mountNode(second.make);
  renderTable({ mount: mount2, data: { items: [] }, editing: true });
  assert.ok(second.textSink.some((t) => t.includes("お土産を追加")), second.textSink.join(" | "));
});

test("renderTable: 何を・誰に・どこで・メモを textContent で出す", () => {
  const { make, textSink } = stubDocument();
  const mount = mountNode(make);
  renderTable({ mount, data: SOUVENIRS, editing: false });
  for (const expected of ["ドライマンゴー", "会社", "空港", "5袋くらい"]) {
    assert.ok(textSink.includes(expected), `${expected} が出ていません`);
  }
});

test("renderTable: 値が innerHTML に流れない（読み取りモード。実際に描かれたことも確認する）", () => {
  const payload = '<img src=x onerror="window.__pwned=1">';
  const { make, htmlSink, textSink } = stubDocument();
  const mount = mountNode(make);
  renderTable({
    mount,
    data: { items: [{ id: "sv-1", name: payload, recipient: payload, shop: payload, note: payload, bought: false }] },
    editing: false,
  });
  // 何も描かれていない（renderTable が早期リターンした等）だけでは
  // htmlSink が空になり、以下の否定条件が意味なく通ってしまう。
  // 行が実際に描かれたこと・値が textContent として出たことを先に確かめる
  const ids = walk(mount)
    .map((n) => n.dataset?.itemId)
    .filter(Boolean);
  assert.deepEqual(ids, ["sv-1"], "行が描かれていません");
  assert.ok(textSink.includes(payload), "値が textContent としても出ていません");
  for (const html of htmlSink) {
    assert.ok(!html.includes(payload), `innerHTML に値が流れました: ${html}`);
  }
});

test("renderTable: 値が innerHTML に流れない（編集モード。value / placeholder に渡る 4 つの入力欄）", () => {
  const payload = '<img src=x onerror="window.__pwned=1">';
  const { make, htmlSink } = stubDocument();
  const mount = mountNode(make);
  renderTable({
    mount,
    data: { items: [{ id: "sv-1", name: payload, recipient: payload, shop: payload, note: payload, bought: false }] },
    editing: true,
  });
  const ids = walk(mount)
    .map((n) => n.dataset?.itemId)
    .filter(Boolean);
  assert.deepEqual(ids, ["sv-1"], "行が描かれていません");
  // 編集モードでは値が innerHTML にも textContent にも乗らず、input.value /
  // placeholder に渡る。読み取りモードのテストと同じ理由で、否定条件（innerHTML に
  // 出ていないこと）だけを見ると、4 つの入力欄が丸ごと描かれなくなる回帰でも
  // 素通りしてしまう。先に、値が実際に input.value として出たことを確かめる
  // （name / recipient / shop / note の 4 欄）
  const payloadInputs = walk(mount).filter((n) => n.tagName === "INPUT" && n.value === payload);
  assert.equal(
    payloadInputs.length,
    4,
    `値が input.value として出た入力欄が 4 つではありません（実際: ${payloadInputs.length}）`
  );
  for (const html of htmlSink) {
    assert.ok(!html.includes(payload), `innerHTML に値が流れました: ${html}`);
  }
});

test("renderTable: 各行に data-item-id を付ける", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  renderTable({ mount, data: SOUVENIRS, editing: false });
  const ids = walk(mount)
    .map((n) => n.dataset?.itemId)
    .filter(Boolean);
  assert.deepEqual(ids, ["sv-001", "sv-002", "sv-003", "sv-004"]);
});

test("renderTable: 「買った」は編集モードでなくても押せる", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  const seen = [];
  renderTable({
    mount,
    data: SOUVENIRS,
    editing: false,
    handlers: { onToggle: (id, bought) => seen.push([id, bought]) },
  });
  const check = findByFocusKey(mount, "sv:sv-002:bought");
  assert.ok(check, "チェックが読み取りモードで出ていません");
  check.checked = true;
  check.dispatch("change");
  assert.deepEqual(seen, [["sv-002", true]]);
});

test("renderTable: 編集モードでだけ入力欄と削除が出る", () => {
  const { make } = stubDocument();
  const read = mountNode(make);
  renderTable({ mount: read, data: SOUVENIRS, editing: false });
  assert.equal(findByFocusKey(read, "sv:sv-001:name"), undefined, "読み取りモードに入力欄があります");
  assert.equal(findByFocusKey(read, "sv:sv-001:del"), undefined, "読み取りモードに削除があります");

  const edit = mountNode(make);
  renderTable({ mount: edit, data: SOUVENIRS, editing: true });
  for (const field of ["name", "recipient", "shop", "note", "del"]) {
    assert.ok(findByFocusKey(edit, `sv:sv-001:${field}`), `${field} が編集モードに出ていません`);
  }
});

test("renderTable: 入力欄の change が onEdit にキーと値を渡す", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  const seen = [];
  renderTable({
    mount,
    data: SOUVENIRS,
    editing: true,
    handlers: { onEdit: (id, patch) => seen.push([id, patch]) },
  });
  const shop = findByFocusKey(mount, "sv:sv-002:shop");
  shop.value = "MBK センター";
  shop.dispatch("change");
  assert.deepEqual(seen, [["sv-002", { shop: "MBK センター" }]]);
});

test("renderTable: 削除は 1 度目で身構え、2 度目で実行する", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  const deleted = [];
  renderTable({
    mount,
    data: SOUVENIRS,
    editing: true,
    handlers: { onDelete: (id) => deleted.push(id) },
  });
  const del = findByFocusKey(mount, "sv:sv-001:del");
  del.dispatch("click");
  assert.deepEqual(deleted, [], "1 度目で消えました");
  del.dispatch("click");
  assert.deepEqual(deleted, ["sv-001"]);
});

test("renderTable: 店名の候補を datalist に出す（重複なし・空文字なし）", () => {
  const { make } = stubDocument();
  const mount = mountNode(make);
  renderTable({ mount, data: SOUVENIRS, editing: true });
  const options = walk(mount)
    .filter((n) => n.tagName === "OPTION")
    .map((n) => n.attrs.value);
  assert.deepEqual(options, ["空港", "チャトチャック市場"]);
});

test("renderTable: handlers を渡さなくても落ちない", () => {
  // テストや初回描画が空で呼ぶ
  const { make } = stubDocument();
  const mount = mountNode(make);
  assert.doesNotThrow(() => renderTable({ mount, data: SOUVENIRS, editing: true }));
});
