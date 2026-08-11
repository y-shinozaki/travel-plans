# 持ち物リストの「その人には不要」（設計）

2026-08-11。**出発前夜に着手すると決めた**（本人の判断）。

`spec/travel-plans-redesign.md` §4.2 のデータモデルに項目を 1 つ足す。
**食い違ったら設計書が正**なので、実装が済んだらこの内容を §4.2 へ反映すること。

## 何が問題か

持ち物の 1 項目は人ごとに `a` / `b` の真偽値を持つ。**未チェックが 2 つの意味を
兼ねてしまっている:**

1. まだ詰めていない
2. **その人にはそもそも要らない**（クレジットカードは雄一だけが持つ、など）

`progressOf()` は全項目を分母に数えるので、2 の項目がある人は**進捗が 100% に
到達できない**。チェックリストとして最後まで使えないということで、これは
「見た目が惜しい」ではなく機能の欠落にあたる。

## データ

```js
item = { id, name, note?, where?, icon?, a: boolean, b: boolean, na?: ("a"|"b")[] }
```

`na` は「この項目が不要な人」。**省略と空配列はどちらも「誰も不要でない」。**

### なぜ `a` / `b` を 3 値にしないのか

`a: null` を「不要」にすればキーは増えない。**採らない。**

`validateItem()` は「`a` / `b` が真偽値でないと進捗が黙って狂う（`"false"` は真に
なる）」という理由で真偽値を必須にしている。3 値にするとこの規則そのものを緩める
ことになり、**いま 39 項目すべてが通っている検査が弱くなる。**
`na` を足す形なら既存の規則は 1 文字も変わらない。

操作の面でも、チェックボックスを 3 状態で回すと「済」に戻すのに「不要」を
経由することになり、指で触る場面で誤操作しやすい。

### なぜ「要る人」（`for`）ではないのか

「雄一のみ」は素直に書けるが、意味が「不要」ではなく「対象」になる。
省略＝全員という既定に寄りかかるので、`members` が増えたときに
**全項目を見直さないと正しさが保てない。** 不要は例外として書くほうが、
数が増えても既存の項目が意味を変えない。

### 保持と復帰

**不要にしても `a` / `b` の値は消さない。** 不要を解除したら以前のチェックが
そのまま戻る ── 「間違えて不要にした」を無傷で取り消せるようにするため。
チェックを消してしまうと、取り消しても情報が戻らない。

### 両方不要は弾く

`na: ["a", "b"]` は `validateItem()` で不備とする。**どちらの分母にも入らない
項目は、リストに在っても誰の役にも立たない**（消せばよい）。許すと、
進捗が 39/39 になっているのに画面には項目が並んでいる、という説明のつかない
状態を作れてしまう。

## 進捗

`progressOf(data, member)` は、`na` に `member` が入っている項目を
**`total` からも `done` からも外す。**

- 朱汰の分母が 39 → 38 になり、100% に到達できる
- `done` からも外すのは、`a`/`b` の値を保持する以上「不要なのにチェック済み」の
  項目がありうるため。分子だけ残ると `done > total` が起こる

## 描画（`packing-render.js`）

**2026-08-11 に作り直した。** 最初は「通常モードはチェックボックス、編集モードは
『不要にする』ピル」という形で実装したが、**求められていたのは違った** ──
人ごとの欄は**ひとつのコントロールで、押すたびに 3 段階を回る**:

```
ブランク → チェック → 不要 → ブランク → …
```

**モードで役割を変えない。** 通常モードでも編集モードでも同じものが同じように回る。
（前の形は「編集モード中はチェックを付け外しできない」という制限を生んでいた。
それも無くなり、元の使い心地に戻る。）

### なぜチェックボックスではなくボタンなのか

`<input type="checkbox">` は 2 状態しか持てない。3 つ目を `indeterminate` で表すことは
できるが、**HTML からは設定できず**、支援技術には「mixed（どちらでもない）」と読まれる
── 「その人には不要」という意味とは違う。しかもクリックの既定動作が「checked の
反転」なので、3 段階に回すには既定動作を止めることになる。

`<button>` にして、現在の状態を `aria-label` で言葉にするほうが正直で単純。
`controls.css` の `.check` の契約（`input` と `.check__box` が隣接兄弟）からは外れるので、
持ち物ページ用の見た目を `packing.css` に持つ。

### 3 つの状態の見た目

**3 状態とも同じ 22px の四角**にすること。大きさが揃っていれば、どの状態の行でも
列が自然に揃う（前の実装では「—」だけ細く、その行の列が 48px ずれた）。

| 状態 | 見た目 |
|---|---|
| ブランク | 枠だけの四角 |
| チェック | 塗った四角にチェックマーク（いまのチェック済みと同じ） |
| 不要 | 枠だけの四角に「—」。文字は薄く（`--ink-2`） |

読み上げは状態と次の動作が分かる形にする（例:
`雄一: パスポート、未チェック`／`雄一: パスポート、チェック済み`／
`雄一: パスポート、不要`）。

### 消すもの

前の実装で足した `naCell()` / `naMark()` / `.napill` / `.napill--off` /
`.pkitem__nadash` / `.pkitem__na` は**すべて不要になる。**

## 状態の遷移（`packing-data.js`）

**遷移の規則は純粋関数に置く**（`packing-render.js` は描画だけを持つ規約）。

```js
cycleMember(item, member) -> item
```

`{a:false, na:なし}` → `{a:true}` → `{a:true, na:["a"]}` → `{a:false, na:なし}`

**不要を抜けるときはチェックを外す。** 前の実装は `a`/`b` の値を保持していたが、
3 段階で回る形では「不要の次はブランク」が見た目の約束なので、値も揃える
── 保持すると「ブランクに見えるのにチェック済み」という状態ができ、
進捗の数字だけが動く。

`withNa()` は残す（検証と進捗のテストが使っている）。`cycleMember()` の中で呼ぶ。

## 検証（`packing-validate.js`）

`validateItem()` に足す規則。**`a` / `b` の既存の規則は変えない。**

- `na` は省略できる。あるときは配列であること
- 要素は `"a"` / `"b"` のいずれか（`members` のキー）
- 同じ値を 2 回入れないこと
- `["a","b"]`（全員不要）は不備

## 移行

**移行作業は無い。** 既存の 39 項目は `na` を持たないので、そのまま今までどおり
通る。`na` は新しく付けたときにだけ現れる。

公開後に**古いコードをキャッシュしている端末**が開いても、`na` を知らないだけで
これまでどおりチェックボックスが出る。壊れない ── その端末では不要な人にも
チェックが出るだけで、データは触られない。

## テスト

- `packing-validate.test.js` — `na` の形（配列・値・重複・全員不要を弾く）。
  `na` を持たない既存の形が通り続けること
- `packing-data.test.js` — `progressOf()` が `na` の人を分母から外すこと、
  `done` からも外すこと（`done > total` を作らない）、付け外しの純粋関数
- `packing-render.test.js` — 通常モードで「—」が出て押せないこと、
  **編集モードでは不要でない人の欄もトグルになる**こと（チェックが出ないこと）、
  読み上げのラベルが分かれること

**実ページでの確認もすること。** `packing.js` はエントリポイントなのでテストが
無く、CSS との組み合わせは `node --test` から見えない（設計書 §13、
2026-08-11 に同じ形の見落としが 3 件出ている）。合言葉が要るので、
使い捨ての合言葉で暗号化したデータを別オリジンに置いて確かめる。

## この変更が触らないもの

`sync.js` / `publish-ui.js` / 旅程 / お土産には一切触らない。
`packing.json` の項目に省略可能なキーが 1 つ増えるだけなので、
同期・暗号化・公開の経路は現状のまま通る。

---

# 実装計画

> **実装する人へ:** `superpowers:subagent-driven-development` か
> `superpowers:executing-plans` を使ってタスク単位で進めること。
> 手順はチェックボックス（`- [ ]`）で追える形にしてある。

**ゴール:** 持ち物の項目に「その人には不要」を持たせ、進捗の分母から外す。

**方針:** 項目に省略可能な `na`（不要な人の配列）を足すだけ。`a` / `b` の
真偽値必須も、同期・暗号化・公開の経路も一切変えない。編集モードでは
人ごとの欄が「不要にする」トグルになる。

**技術:** 素の ES モジュール。ビルド無し。テストは `node --test`。

## 全体の制約

- **色リテラルを CSS に書かない。** `tokens.css` の変数を使う（`tokens.test.js` が検査する）
- **イベント由来の文字列を `innerHTML` に流さない。** 文字は `el()`（`textContent`）
- `packing.js` はエントリポイントなのでテストを持たない（既存の規約）。
  そこに載せるロジックは最小にし、判断は `packing-data.js` 側の純粋関数に置く
- 各タスクの最後に `node --test` 全体を通してからコミットする
- ブランチは `feat/packing-not-applicable`（作成済み）

---

## Task 1: 検証に `na` の規則を足す

**ファイル:**
- 変更: `assets/js/packing-validate.js`（`validateItem()`）
- テスト: `tests/packing-validate.test.js`

**インターフェース:**
- 提供: `validateItem(item, seenIds, where)` の戻り値（不備の文字列配列）は変えない。
  `na` に関する不備が増えるだけ

- [ ] **Step 1: 失敗するテストを書く**

`tests/packing-validate.test.js` の末尾に足す:

```js
test("na は省略できる（既存の項目がそのまま通る）", () => {
  const item = { id: "x", name: "現金", a: true, b: false };
  assert.deepEqual(validateItem(item), []);
});

test("na が配列でなければ弾く", () => {
  const item = { id: "x", name: "現金", a: true, b: false, na: "b" };
  const problems = validateItem(item);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /na が配列ではありません/);
});

test("na に未知の人が入っていれば弾く", () => {
  const item = { id: "x", name: "現金", a: true, b: false, na: ["c"] };
  assert.match(validateItem(item)[0], /na に未知の人/);
});

test("na の重複を弾く", () => {
  const item = { id: "x", name: "現金", a: true, b: false, na: ["b", "b"] };
  assert.match(validateItem(item)[0], /2 回/);
});

test("全員に不要な項目は弾く", () => {
  // どちらの分母にも入らない項目は、リストに在っても誰の役にも立たない。
  // 許すと「進捗は 39/39 なのに画面には項目が並んでいる」が作れてしまう
  const item = { id: "x", name: "現金", a: true, b: false, na: ["a", "b"] };
  assert.match(validateItem(item).join("\n"), /全員に不要/);
});

test("na があっても a / b の真偽値必須は変わらない", () => {
  const item = { id: "x", name: "現金", a: "true", b: false, na: ["b"] };
  assert.match(validateItem(item)[0], /真偽値ではありません/);
});
```

- [ ] **Step 2: 落ちることを確かめる**

実行: `node --test tests/packing-validate.test.js`
期待: 「na が配列でなければ弾く」以下が FAIL（`na` を誰も見ていないため
不備が 0 件になる）。「na は省略できる」だけは最初から PASS

- [ ] **Step 3: 実装する**

`assets/js/packing-validate.js` の `validateItem()` の、`a` / `b` を見る
`for` ループの**直後**（`return problems;` の直前）に足す:

```js
  // na（その人には不要）は省略できる。あるときだけ形を見る。
  // a / b の規則には触らない ── 不要にしてもチェックの値は保持するので、
  // 「不要だが真偽値としては壊れている」も不備として出したい
  if (item.na !== undefined) {
    if (!Array.isArray(item.na)) {
      problems.push(`${label}: na が配列ではありません（${show(item.na)}）`);
    } else {
      const seen = new Set();
      for (const member of item.na) {
        if (member !== "a" && member !== "b") {
          problems.push(
            `${label}: na に未知の人が入っています（${show(member)} / 有効な値は a, b）`
          );
        } else if (seen.has(member)) {
          problems.push(`${label}: na に ${member} が 2 回入っています`);
        }
        seen.add(member);
      }
      if (seen.has("a") && seen.has("b")) {
        problems.push(`${label}: 全員に不要な項目は置けません（項目ごと消してください）`);
      }
    }
  }
```

- [ ] **Step 4: 通ることを確かめる**

実行: `node --test`
期待: 全件 PASS（既存の 611 件 + 新しい 6 件）

- [ ] **Step 5: コミット**

```bash
git add assets/js/packing-validate.js tests/packing-validate.test.js
git commit -m "Let an item say it is not needed for someone"
```

---

## Task 2: 進捗と、`na` を切り替える純粋関数

**ファイル:**
- 変更: `assets/js/packing-data.js`（`progressOf()` を直し、`withNa()` を足す）
- テスト: `tests/packing-data.test.js`

**インターフェース:**
- 消費: Task 1 の `na` の形（`("a"|"b")[]`）
- 提供: `withNa(item, member, notNeeded) -> item`（**項目 1 件**を受けて 1 件を返す。
  データ全体ではない）。`progressOf(data, member) -> { done, total }` は
  戻り値の形を変えない

- [ ] **Step 1: 失敗するテストを書く**

`tests/packing-data.test.js` の末尾に足す:

```js
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
```

`tests/packing-data.test.js` の import に `withNa` を足す（既に
`progressOf` を import している行に並べる）。

- [ ] **Step 2: 落ちることを確かめる**

実行: `node --test tests/packing-data.test.js`
期待: FAIL。`withNa` が未定義、進捗は `total: 3` のまま

- [ ] **Step 3: 実装する**

`assets/js/packing-data.js` の `progressOf()` を差し替える:

```js
export function progressOf(data, member) {
  let done = 0;
  let total = 0;
  for (const group of data.groups) {
    for (const item of group.items) {
      // その人に不要な項目は分母からも分子からも外す。
      // **分子からも外すこと** ── 不要にしても a / b の値は保持するので
      // （withNa 参照）、分子だけ残すと done > total が起こる
      if (item.na?.includes(member)) continue;
      total++;
      if (item[member] === true) done++;
    }
  }
  return { done, total };
}
```

同じファイルの末尾に足す:

```js
/**
 * 項目 1 件の「その人には不要」を切り替えた**新しい項目**を返す。
 * データ全体ではなく項目 1 件を受けるのは、呼び出し側が withItem() と
 * 組み合わせて使うため（既存の onToggle と同じ形）。
 *
 * **a / b の値は触らない。** 不要を解除したら以前のチェックが戻るようにするため
 * ── 消してしまうと「間違えて不要にした」を無傷で取り消せない。
 *
 * 空になったら na のキーごと落とす。「省略＝誰も不要でない」という既定に
 * 戻すためで、空配列を残すと同じ意味の書き方が 2 通りになる。
 */
export function withNa(item, member, notNeeded) {
  const current = Array.isArray(item.na) ? item.na : [];
  const next = notNeeded
    ? current.includes(member)
      ? current
      : [...current, member]
    : current.filter((m) => m !== member);
  const { na, ...rest } = item;
  return next.length ? { ...rest, na: next } : rest;
}
```

- [ ] **Step 4: 通ることを確かめる**

実行: `node --test`
期待: 全件 PASS

- [ ] **Step 5: コミット**

```bash
git add assets/js/packing-data.js tests/packing-data.test.js
git commit -m "Leave the unneeded out of the count"
```

---

## Task 3: 描画（通常は「—」、編集はトグル）

**ファイル:**
- 変更: `assets/js/packing-render.js`（`itemRow()` と、新しい 2 つのセル）
- 変更: `assets/css/packing.css`（`.napill` / `.pkitem__na`）
- テスト: `tests/packing-render.test.js`

**インターフェース:**
- 消費: Task 2 の `na` の形
- 提供: `renderTable()` の `handlers` に **`onToggleNa(itemId, member, notNeeded)`**
  が増える（Task 4 が渡す）。既存の `onToggle` の形は変えない

- [ ] **Step 1: 失敗するテストを書く**

`tests/packing-render.test.js` の末尾に足す:

```js
test("通常モードでは、不要な人の欄はチェックではなく「—」になる", () => {
  const { make, textSink } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [{ id: "g1", name: "貴重品", icon: "i-note", items: [
      { id: "i1", name: "カード", note: "", a: true, b: true, na: ["b"] },
    ] }],
  };
  renderTable({ mount, data, editing: false, handlers: {} });

  const checks = findAll(mount, (n) => n.tagName === "INPUT");
  assert.equal(checks.length, 1, "不要な人にもチェックが出ています");
  assert.equal(checks[0].attrs["aria-label"], "雄一: カード");

  const mark = findFirst(mount, (n) => n.attrs?.["aria-label"] === "朱汰には不要: カード");
  assert.ok(mark, "不要の印がありません");
  assert.ok(textSink.includes("—"), "「—」が textContent に入っていません");
});

test("編集モードでは、不要でない人の欄もトグルになる（チェックは出ない）", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [{ id: "g1", name: "貴重品", icon: "i-note", items: [
      { id: "i1", name: "カード", note: "", a: true, b: true },
    ] }],
  };
  renderTable({ mount, data, editing: true, handlers: {} });

  assert.equal(
    findAll(mount, (n) => n.tagName === "INPUT" && n.type === "checkbox").length,
    0,
    "編集モードにチェックボックスが残っています"
  );
  const labels = findAll(mount, (n) => n.tagName === "BUTTON")
    .map((b) => b.attrs["aria-label"])
    .filter(Boolean);
  assert.ok(labels.includes("雄一には不要にする: カード"), labels.join(" / "));
  assert.ok(labels.includes("朱汰には不要にする: カード"), labels.join(" / "));
});

test("編集モードで不要な人の欄は「戻す」になり、押すと解除を伝える", () => {
  const { make } = stubDocument();
  const mount = make("div");
  const data = {
    members: { a: "雄一", b: "朱汰" },
    groups: [{ id: "g1", name: "貴重品", icon: "i-note", items: [
      { id: "i1", name: "カード", note: "", a: true, b: true, na: ["b"] },
    ] }],
  };
  const calls = [];
  renderTable({
    mount, data, editing: true,
    handlers: { onToggleNa: (...args) => calls.push(args) },
  });

  const back = findFirst(
    mount,
    (n) => n.tagName === "BUTTON" && n.attrs?.["aria-label"] === "朱汰に戻す: カード"
  );
  assert.ok(back, "戻すボタンがありません");
  back.dispatch("click");
  assert.deepEqual(calls, [["i1", "b", false]]);
});
```

**注意:** `stubDocument()` は `{ htmlSink, textSink, make }` を返す。
`mount` は `make("div")` で作る。`findAll(node, pred)` / `findFirst(node, pred)` も
このファイルに既にあるので、新しく作らないこと。
ノードのクリックは `node.dispatch("click")`（スタブが持っている）。

- [ ] **Step 2: 落ちることを確かめる**

実行: `node --test tests/packing-render.test.js`
期待: FAIL（いまは editing に関わらずチェックボックスが 2 つ出る）

- [ ] **Step 3: 実装する**

`assets/js/packing-render.js` の `checkCell()` の**直後**に足す:

```js
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
```

同じファイルの `itemRow()` の中の `checks` を組み立てている `for` を差し替える:

```js
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
```

`assets/css/packing.css` の `.pkitem__checks` の定義の**直後**に足す:

```css
/* 編集モードの「不要にする」。**四角いチェックと見た目を変えるのが目的**なので、
   ピルにする（同じ四角が意味だけ変えると取り違えが起きる。設計書 §13 と
   plans/packing-not-applicable.md） */
.napill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--ink-2);
  font-size: 10px;
  letter-spacing: 1px;
  white-space: nowrap;
}
.napill:hover {
  color: var(--ink);
  border-color: var(--ink);
}
/* 不要になっている側。枠を濃くして、押せば戻ることを見た目で示す */
.napill--off {
  color: var(--ink);
  border-color: var(--ink);
}
/* 通常モードの「—」。押せないので枠は持たせない。
   色は --ink-2（副次テキスト）。--ink-3 は tokens.css では「濃色パネル」で
   --ink-2 より**濃い**ので、薄い印には使わない */
.pkitem__na {
  color: var(--ink-2);
  font-size: 12px;
}
```

- [ ] **Step 4: 古い挙動を前提にした既存テスト 3 本を直す**

**この 3 本は「編集モードにもチェックボックスがある」ことを前提にしている。**
挙動を変えると決めたのはこの設計なので、テストのほうを新しい挙動に合わせる
（2026-08-11、本人の判断）。**消さずに、新しい前提を検査する形に書き換えること。**

1. 「編集モードでは項目名・区分名・メモの入力欄が増える」
   （`tests/packing-render.test.js`）

   ```js
   const inputCount = findAll(editing, (n) => n.tagName === "INPUT").length;
   // 項目名 4 + メモ 4 + 区分名 3 = 11。
   // **チェックボックスは編集モードには無い**（人ごとの欄は「不要にする」の
   // トグルになる。plans/packing-not-applicable.md）
   assert.equal(inputCount, 11);
   ```

2. 「行の操作ハンドラも個別に省略できる（onToggle などが無くても押せる）」

   チェックボックスは編集モードから消えたので、**通常モードで引く**形に変える:

   ```js
   renderTable({ mount, data: PACKING, editing: false, handlers: {} });
   const checkbox = findFirst(mount, (n) => n.tagName === "INPUT" && n.type === "checkbox");
   assert.doesNotThrow(() => checkbox.dispatch("change"));
   ```

   あわせて、編集モードのトグルもハンドラ無しで押せることを見る 1 行を足す:

   ```js
   const editing = make("div");
   renderTable({ mount: editing, data: PACKING, editing: true, handlers: {} });
   const pill = findFirst(editing, (n) => n.dataset?.focusKey === "item:passport:na:a");
   assert.doesNotThrow(() => pill.dispatch("click"));
   ```

3. 「項目・区分の操作コントロールに data-focus-key が付く（id から作る）」

   `check:a` / `check:b` は編集モードには無くなるので、**`na:a` / `na:b` を
   見る**形に変える:

   ```js
   assert.ok(keys.has("item:passport:na:a"), "不要にするボタン(a)にキーが無い");
   assert.ok(keys.has("item:passport:na:b"), "不要にするボタン(b)にキーが無い");
   ```

   **`check:a` / `check:b` の検査は消さず、通常モードへ移すこと** ── 通常モードの
   チェックボックスにフォーカスキーが要るのは変わらない。同じテストの中で
   `editing: false` の mount を作って確かめる。

- [ ] **Step 5: 通ることを確かめる**

実行: `node --test`
期待: 全件 PASS。**`tokens.test.js` の色リテラル検査も通ること**
（`--ink-3` などの変数しか使っていない）

- [ ] **Step 6: コミット**

```bash
git add assets/js/packing-render.js assets/css/packing.css tests/packing-render.test.js
git commit -m "Show a dash where a check would make no sense"
```

---

## Task 4: 配線とブラウザでの確認

**ファイル:**
- 変更: `assets/js/packing.js`（`handlers` に `onToggleNa` を足す）

**インターフェース:**
- 消費: Task 2 の `withNa(item, member, notNeeded)`、Task 3 の
  `handlers.onToggleNa(itemId, member, notNeeded)`

- [ ] **Step 1: 実装する**

`assets/js/packing.js` の import に `withNa` を足す（`withItem` を import
している行に並べる）。`handlers` の `onToggle` の**直後**に足す:

```js
  onToggleNa(itemId, member, notNeeded) {
    const item = state.data.groups.flatMap((g) => g.items).find((i) => i.id === itemId);
    if (!item) return;
    apply(withItem(state.data, null, withNa(item, member, notNeeded)));
  },
```

- [ ] **Step 2: テストが通ったままであることを確かめる**

実行: `node --test`
期待: 全件 PASS（`packing.js` はテストを持たないので件数は増えない）

- [ ] **Step 3: 検証用サイトを作る**

**合言葉が要るので実ページを直接は開けない。使い捨ての合言葉で暗号化した
データを別オリジンに置いて確かめる**（2026-08-11 に確立した手順）:

`$SCRATCH` はこのセッションの scratchpad ディレクトリ（システムから与えられる
パス）。`make-fixture.mjs` は 2026-08-11 に書いたもので、`assets/js/crypto.js` と
`tests/fixtures/packing.js` を読んで封筒 JSON と鍵素材を書き出す。残っていなければ
同じ内容で書き直す（`deriveKey` → `createCodec` → `encode` の 3 行）。

```bash
SITE="$SCRATCH/site"
rm -rf "$SITE"; mkdir -p "$SITE"
cp *.html "$SITE/"; cp -R assets "$SITE/"
# tests/fixtures/packing.js を使い捨ての合言葉で暗号化して
# $SITE/assets/data/packing.json に書き、鍵素材を控える
node "$SCRATCH/make-fixture.mjs"
cd "$SITE" && python3 -m http.server 8040
```

ブラウザで `localStorage.setItem("tp:key", <控えた鍵素材>)` を入れてから開く。
**本物の合言葉も本番データも使わない。**

- [ ] **Step 4: ブラウザで確かめる**

- 通常モード: 不要な人の欄が「—」で、チェックボックスが出ていないこと
- 「リストを編集」: 両方の人の欄がピルになり、**チェックボックスが 1 つも
  無いこと**
- ピルを押す → 「—」に変わる → 「編集を終える」→ その人の**進捗の分母が
  1 減る**こと
- もう一度不要を解除 → **以前のチェックが戻っている**こと
- スマートフォン幅（414px）で行が破綻しないこと

- [ ] **Step 5: 後片付けとコミット**

サーバーを止め、検証用サイトを消し、ブラウザの `localStorage` を空にする。

```bash
git add assets/js/packing.js
git commit -m "Wire the not-needed toggle"
```

---

## Task 5: ドキュメントを実態に合わせる

**ファイル:**
- 変更: `docs/spec/travel-plans-redesign.md`（§4.2 のデータモデル）
- 変更: `docs/handoff/2026-08-10.md`（持ち物の確認手順 6）
- 変更: `docs/README.md`（`plans/` の表の状態）
- **`CLAUDE.md` は変更しない。** 持ち物の項目の形をどこにも書いていないので
  （`packing.json` の存在と同期の話しかない）、写す先が無い

- [ ] **Step 1: 設計書 §4.2 に `na` を足す**

項目の形に `na?: ("a"|"b")[]` を足し、**この計画の「データ」節の判断
（3 値にしない理由・値を保持する理由・全員不要を弾く理由）を写す。**
設計書が正なので、根拠は必ずそちらに置くこと。

- [ ] **Step 2: 確認手順 6 を直す**

`docs/handoff/2026-08-10.md` の持ち物の手順 6 は「チェックを付ける」だが、
**編集モードではチェックを付けられなくなった。**「編集を終えてからチェックを
付ける」形に直し、「編集モードでは人ごとの欄が『不要にする』になる」ことを足す。

- [ ] **Step 3: 索引の状態を更新**

`docs/README.md` の `plans/` の表で、この計画の状態を「設計のみ」から
「完了」に変える。

- [ ] **Step 4: 全体を通す**

実行: `node --test`
期待: 全件 PASS

- [ ] **Step 5: コミット**

```bash
git add docs CLAUDE.md
git commit -m "Write down that an item can be not-needed"
```

---

## 完了の条件

- `node --test` が全件 PASS（新しいテストは 15 件前後増える）
- ブラウザで Task 4 Step 4 の 5 点を実際に確かめた
- 設計書 §4.2 に `na` が載っている
- **公開はまだしない。** 公開すると他の 5 人に反映されるので、
  押す前に変更内容を見せて承認を取ること
