import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyPacking,
  nextGroupId,
  nextItemId,
  withGroup,
  withoutGroup,
  withItem,
  withoutItem,
  moveItem,
  moveGroup,
  progressOf,
  groupProgressOf,
  withNa,
  cycleMember,
} from "../assets/js/packing-data.js";
import { validatePacking } from "../assets/js/packing-validate.js";
import { PACKING } from "./fixtures/packing.js";

const clone = () => JSON.parse(JSON.stringify(PACKING));
/** 区分ごとの項目 id を並べた、比較しやすい形にする。 */
const shape = (data) => data.groups.map((g) => [g.id, g.items.map((i) => i.id)]);

/**
 * data・groups・items・各オブジェクトを再帰的に凍結する。ES モジュールは
 * strict mode なので、凍結済みオブジェクトへの書き込みは（黙って無視されず）
 * 例外を投げる。「入力を変更しない」を全操作についてまとめて確かめるための
 * 道具 ── withItem 用の「元は変えない」個別アサーションを他の関数にも
 * 書き写す代わりに、ここ 1 箇所で網羅する。
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

test("emptyPacking は検査を通る", () => {
  const data = emptyPacking();
  assert.equal(validatePacking(data), data);
  assert.deepEqual(data.groups, []);
});

test("nextItemId は使われている id を避ける", () => {
  const data = clone();
  data.groups[0].items[0].id = "it-001";
  const id = nextItemId(data.groups);
  assert.notEqual(id, "it-001");
  assert.match(id, /^it-\d{3}$/);
});

test("nextGroupId / nextItemId は件数と最大値がずれていても衝突しない", () => {
  // 途中を削除したデータでは「件数 + 1」が既に埋まっていることがある
  const groups = [
    { id: "g-001", name: "a", items: [{ id: "it-001", name: "x", a: false, b: false }] },
    { id: "g-002", name: "b", items: [{ id: "it-002", name: "y", a: false, b: false }] },
  ];
  assert.equal(nextGroupId(groups), "g-003");
  assert.equal(nextItemId(groups), "it-003");
});

test("withItem は指定した区分の末尾に足す", () => {
  const data = clone();
  const next = withItem(data, "g-clothes", { id: "it-new", name: "サンダル", note: "", a: false, b: false });
  assert.deepEqual(
    next.groups.find((g) => g.id === "g-clothes").items.map((i) => i.id),
    ["swimwear", "it-new"]
  );
  // 元は変えない
  assert.equal(data.groups.find((g) => g.id === "g-clothes").items.length, 1);
});

test("withItem は同じ id があれば差し替える（重複を作らない）", () => {
  const data = clone();
  const next = withItem(data, "g-valuables", { id: "cash", name: "現金（円）", note: "", a: true, b: true });
  const items = next.groups.find((g) => g.id === "g-valuables").items;
  assert.equal(items.filter((i) => i.id === "cash").length, 1);
  assert.equal(items.find((i) => i.id === "cash").name, "現金（円）");
});

test("withItem は既存の項目を編集しても区分を移動しない（groupId は新規追加のときだけ使う）", () => {
  // 解消済みの曖昧さ #3: groupId には呼び出し側が null を渡すこともある
  const data = clone();
  const withDifferentGroupId = withItem(data, "g-clothes", {
    id: "cash",
    name: "現金（円）",
    note: "",
    a: true,
    b: true,
  });
  assert.deepEqual(shape(withDifferentGroupId), [
    ["g-valuables", ["passport", "cash", "insurance"]],
    ["g-clothes", ["swimwear"]],
    ["g-empty", []],
  ]);

  const withNullGroupId = withItem(data, null, {
    id: "cash",
    name: "現金（円・null 経由）",
    note: "",
    a: true,
    b: true,
  });
  const items = withNullGroupId.groups.find((g) => g.id === "g-valuables").items;
  assert.equal(items.find((i) => i.id === "cash").name, "現金（円・null 経由）");
});

test("withGroup は同じ id があれば差し替える（重複を作らない）", () => {
  const data = clone();
  const next = withGroup(data, { id: "g-valuables", name: "貴重品（改）", icon: "i-lock", items: [] });
  assert.equal(next.groups.length, 3);
  assert.equal(next.groups.filter((g) => g.id === "g-valuables").length, 1);
  assert.equal(next.groups.find((g) => g.id === "g-valuables").name, "貴重品（改）");
  // 元は変えない
  assert.equal(data.groups.find((g) => g.id === "g-valuables").name, "貴重品・書類");
});

test("withoutItem は id で消す。どの区分にあっても効く", () => {
  const data = clone();
  const next = withoutItem(data, "swimwear");
  assert.deepEqual(shape(next), [
    ["g-valuables", ["passport", "cash", "insurance"]],
    ["g-clothes", []],
    ["g-empty", []],
  ]);
});

test("withoutGroup は中身ごと消す", () => {
  const data = clone();
  const next = withoutGroup(data, "g-valuables");
  assert.deepEqual(next.groups.map((g) => g.id), ["g-clothes", "g-empty"]);
});

test("moveItem は区分の中で上へ入れ替える", () => {
  const data = clone();
  const next = moveItem(data, "cash", -1);
  assert.deepEqual(
    next.groups[0].items.map((i) => i.id),
    ["cash", "passport", "insurance"]
  );
});

test("moveItem は区分の中で下へも入れ替える", () => {
  // 上下で分岐が対称なことを別々に確かめる（splice の挙動自体は向きを問わないが、
  // ブリーフが 4 通りの境界の組み合わせを求めている）
  const data = clone();
  const next = moveItem(data, "passport", +1);
  assert.deepEqual(
    next.groups[0].items.map((i) => i.id),
    ["cash", "passport", "insurance"]
  );
});

test("moveItem は区分の端（下）で隣の区分の先頭へ送る", () => {
  // 設計書 §7.3「↑↓ で端に達したとき隣の区分へ送る」。delta = +1 側
  const data = clone();
  const next = moveItem(data, "insurance", +1);
  assert.deepEqual(shape(next), [
    ["g-valuables", ["passport", "cash"]],
    ["g-clothes", ["insurance", "swimwear"]],
    ["g-empty", []],
  ]);
});

test("moveItem は区分の端（上）で隣の区分の末尾へ送る", () => {
  // delta = -1 側。moveItem の push/unshift の分岐
  // (`delta === -1 ? [...g.items, item] : [item, ...g.items]`) は、
  // これまで delta = +1 の境界テストしか無く、unshift 側しか実行されていなかった
  // （レビュー指摘）。swimwear は g-clothes の唯一（=先頭）の項目
  const data = clone();
  const next = moveItem(data, "swimwear", -1);
  assert.deepEqual(shape(next), [
    ["g-valuables", ["passport", "cash", "insurance", "swimwear"]],
    ["g-clothes", []],
    ["g-empty", []],
  ]);
});

test("moveItem は先頭の区分の先頭より上へは動かさない", () => {
  const data = clone();
  const next = moveItem(data, "passport", -1);
  assert.deepEqual(shape(next), shape(data), "動かないこと");
});

test("moveItem は末尾の区分の末尾より下へは動かさない", () => {
  const data = clone();
  // g-empty は空なので、swimwear を下へ送ると g-empty に入る
  const once = moveItem(data, "swimwear", +1);
  assert.deepEqual(shape(once), [
    ["g-valuables", ["passport", "cash", "insurance"]],
    ["g-clothes", []],
    ["g-empty", ["swimwear"]],
  ]);
  // そこからさらに下へは行けない
  assert.deepEqual(shape(moveItem(once, "swimwear", +1)), shape(once));
});

test("moveGroup は区分の順番を入れ替える", () => {
  const data = clone();
  assert.deepEqual(
    moveGroup(data, "g-clothes", -1).groups.map((g) => g.id),
    ["g-clothes", "g-valuables", "g-empty"]
  );
  assert.deepEqual(
    moveGroup(data, "g-valuables", -1).groups.map((g) => g.id),
    ["g-valuables", "g-clothes", "g-empty"],
    "先頭より上へは動かさない"
  );
});

test("moveGroup は末尾の区分を末尾より下へは動かさない", () => {
  const data = clone();
  // 並び順だけでは区別が付かない（splice は範囲外の挿入位置を末尾に丸めるため
  // ガードが無くても偶然同じ並びになる）。「入力をそのまま返した」ことまで見る
  assert.equal(moveGroup(data, "g-empty", +1), data);
});

test("moveGroup は見つからない id では何もしない", () => {
  const data = clone();
  assert.equal(moveGroup(data, "g-does-not-exist", -1), data);
  // delta = +1 も別に確かめる。ガードを外すと index=-1, target=0 が
  // 境界チェックを素通りし、splice(-1,1) が実在する最後の区分を
  // 存在しない id のために先頭へ動かしてしまう（レビュー指摘。delta=-1 側は
  // target<0 の別ガードに偶然救われて検出できない）
  assert.equal(moveGroup(data, "g-does-not-exist", +1), data);
});

test("moveGroup は ±1 以外の delta では何もしない", () => {
  const data = clone();
  assert.equal(moveGroup(data, "g-clothes", 0), data);
  assert.equal(moveGroup(data, "g-clothes", 2), data);
});

test("moveItem は見つからない id では何もしない", () => {
  const data = clone();
  assert.equal(moveItem(data, "it-does-not-exist", -1), data);
});

test("moveItem は ±1 以外の delta では何もしない", () => {
  const data = clone();
  assert.equal(moveItem(data, "cash", 0), data);
  assert.equal(moveItem(data, "cash", 2), data);
});

test("すべての操作の結果は検査を通る", () => {
  // 「保存はできたが次の読み込みで弾かれる」データを操作で作れないこと
  const data = clone();
  const results = [
    withItem(data, "g-empty", { id: nextItemId(data.groups), name: "新しい項目", note: "", a: false, b: false }),
    withGroup(data, { id: nextGroupId(data.groups), name: "新しい区分", icon: "i-note", items: [] }),
    withoutItem(data, "cash"),
    withoutGroup(data, "g-clothes"),
    moveItem(data, "insurance", +1),
    moveGroup(data, "g-empty", -1),
  ];
  for (const result of results) assert.equal(validatePacking(result), result);
});

test("progressOf は 2 人分を別々に数える", () => {
  assert.deepEqual(progressOf(PACKING, "a"), { done: 2, total: 4 });
  assert.deepEqual(progressOf(PACKING, "b"), { done: 2, total: 4 });
});

test("progressOf は項目がゼロでも落ちない", () => {
  assert.deepEqual(progressOf(emptyPacking(), "a"), { done: 0, total: 0 });
});

test("どの操作も入力を変更しない（凍結したデータへの書き込みは例外になる）", () => {
  const frozen = deepFreeze(clone());
  assert.doesNotThrow(() => {
    withItem(frozen, "g-empty", { id: "it-x", name: "x", note: "", a: false, b: false });
    withGroup(frozen, { id: "g-x", name: "x", icon: "i-note", items: [] });
    withGroup(frozen, { id: "g-valuables", name: "上書き", icon: "i-lock", items: [] });
    withoutItem(frozen, "cash");
    withoutGroup(frozen, "g-clothes");
    moveItem(frozen, "insurance", +1);
    moveItem(frozen, "passport", -1); // 全体の先頭での no-op 経路
    moveItem(frozen, "swimwear", +1); // 隣の区分へ送る経路
    moveGroup(frozen, "g-clothes", -1);
    moveGroup(frozen, "g-valuables", -1); // 全体の先頭での no-op 経路
    progressOf(frozen, "a");
  });
});

const NA_DATA = {
  members: { a: "雄一", b: "朱汰" },
  groups: [
    {
      id: "g1",
      name: "貴重品",
      items: [
        { id: "i1", name: "パスポート", a: true, b: true },
        // 朱汰には不要。しかも a も b も true のまま（不要にしても値は保持する）
        { id: "i2", name: "クレジットカード", a: true, b: true, na: ["b"] },
        { id: "i3", name: "現金", a: false, b: false },
      ],
    },
  ],
};

test("進捗は不要な人の項目を分母から外す", () => {
  assert.deepEqual(progressOf(NA_DATA, "a"), { done: 2, total: 3 });
  // 朱汰は i2 が消えるので 3 → 2 件
  assert.deepEqual(progressOf(NA_DATA, "b"), { done: 1, total: 2 });
});

test("不要な項目は分子からも外す（done > total を作らない）", () => {
  // 不要にしてもチェックの値は保持するので、i2 の b は true のまま。
  // 分子だけ残すと done(2) > total(2) にはならないが、項目が増えれば必ず起こる
  const { done, total } = progressOf(NA_DATA, "b");
  assert.ok(done <= total, `done(${done}) が total(${total}) を超えています`);
});

test("withNa は不要にしてもチェックの値を消さない", () => {
  const item = { id: "i", name: "カード", a: true, b: true };
  const off = withNa(item, "b", true);
  assert.deepEqual(off.na, ["b"]);
  assert.equal(off.b, true, "解除したときに戻せなくなります");
});

test("withNa は空になったら na のキーごと落とす", () => {
  const item = { id: "i", name: "カード", a: true, b: true, na: ["b"] };
  const on = withNa(item, "b", false);
  assert.equal("na" in on, false, "空配列が残っています");
});

test("withNa は同じ人を 2 回入れない", () => {
  const item = { id: "i", name: "カード", a: true, b: true, na: ["b"] };
  assert.deepEqual(withNa(item, "b", true).na, ["b"]);
});

test("withNa は元の項目を書き換えない", () => {
  const item = { id: "i", name: "カード", a: true, b: true };
  withNa(item, "b", true);
  assert.equal("na" in item, false, "元の項目が書き換えられています");
});

test("cycleMember はブランク→チェック→不要→ブランクの順で一周する", () => {
  const blank = { id: "i", name: "カード", a: false, b: false };

  const checked = cycleMember(blank, "a");
  assert.equal(checked.a, true, "ブランクの次はチェックのはず");
  assert.equal("na" in checked, false);

  const notNeeded = cycleMember(checked, "a");
  assert.deepEqual(notNeeded.na, ["a"], "チェックの次は不要のはず");
  assert.equal(notNeeded.a, true, "不要に入るときはチェックの値を保持する");

  const backToBlank = cycleMember(notNeeded, "a");
  assert.equal("na" in backToBlank, false, "不要の次はブランクに戻るはず");
  assert.equal(backToBlank.a, false, "不要を抜けるときはチェックも外す");

  // 一周して同じ形に戻ること
  assert.deepEqual(backToBlank, blank);
});

test("cycleMember はもう一方の人（b）には影響しない", () => {
  const item = { id: "i", name: "カード", a: false, b: true };
  const next = cycleMember(item, "a");
  assert.equal(next.b, true, "b の値が変わっています");
});

test("cycleMember は元の項目を書き換えない（3 つの遷移経路すべて）", () => {
  const blank = deepFreeze({ id: "i", name: "カード", a: false, b: false });
  const checked = deepFreeze({ id: "i", name: "カード", a: true, b: false });
  const notNeeded = deepFreeze({ id: "i", name: "カード", a: true, b: false, na: ["a"] });
  assert.doesNotThrow(() => {
    cycleMember(blank, "a"); // ブランク → チェック
    cycleMember(checked, "a"); // チェック → 不要
    cycleMember(notNeeded, "a"); // 不要 → ブランク
  });
});

test("groupProgressOf は na を持つ項目を、不要な人を除く全員が詰めたら完了として数える", () => {
  // i2 は朱汰(b)には不要。雄一(a)だけが対象で、a はすでに true なので
  // 「詰め終わった」項目として数える ── i.a && i.b のままだと b が false のぶん
  // 永久に未完了に見える
  const group = {
    id: "g1",
    name: "貴重品",
    items: [
      { id: "i1", name: "パスポート", a: true, b: true },
      { id: "i2", name: "クレジットカード", a: true, b: false, na: ["b"] },
      { id: "i3", name: "現金", a: false, b: false },
    ],
  };
  assert.deepEqual(groupProgressOf(group), { done: 2, total: 3 });
});

test("groupProgressOf は na が無ければ両方チェックされた項目だけを数える", () => {
  // na を 1 つも持たない区分での基本挙動を見る。na が無い項目では
  // required が常に ["a","b"] になるので、この形の入力では正しい実装と
  // 旧ロジック（i.a && i.b）は式として一致し、この 1 本だけでは退行を
  // 検出できない ── na があるときに両者が食い違うことは、直前の
  // 「na を持つ項目を、不要な人を除く全員が詰めたら完了として数える」テストが見る
  const group = {
    id: "g1",
    name: "貴重品",
    items: [
      { id: "i1", name: "パスポート", a: true, b: true }, // 両方 true → 完了
      { id: "i2", name: "現金", a: true, b: false }, // 片方だけ → 未完了
      { id: "i3", name: "保険証", a: false, b: false }, // 両方 false → 未完了
    ],
  };
  assert.deepEqual(groupProgressOf(group), { done: 1, total: 3 });
});

test("groupProgressOf は項目が無い区分でも落ちない", () => {
  assert.deepEqual(groupProgressOf({ id: "g-empty", name: "空", items: [] }), {
    done: 0,
    total: 0,
  });
});
