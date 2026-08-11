/**
 * 持ち物リストの純粋なデータ操作。DOM も store も知らない。
 *
 * event-editor.js の nextEventId / withEvent / withoutEvent と同じ考え方で、
 * 「壊れたときの失われ方が静かな部分」をここへ集めてある ──
 * 「移動したら項目が消えていた」は、次にそのリストを見るまで誰も気付かない。
 *
 * すべての関数は新しいオブジェクトを返し、渡されたデータを変更しない。
 * 描画の途中で配列を書き換えると、保存されるものと画面に出ているものが
 * 食い違う（schedule.js の setData と同じ理由）。
 *
 * 設計書 §4.2 / §7.3 に対応。
 */

/**
 * 荷物のどこへ入れるか。categories.js の CAT_META と同じ作法で、
 * 「キー ↔ 画面に出す言葉」の対応をここ 1 か所だけに置く。
 *
 * **キーを画面の文言で持たないこと。** 表示を変えたくなったときに、
 * 保存済みのデータを全部書き換える羽目になる。
 *
 * 空（未設定）を明示的な値にしないのは、持ち物のほとんどが
 * 「まだ決めていない」状態から始まるため ── 既定値を持つと、
 * 決めたのか決めていないのかが区別できなくなる。
 * item.where は省略可能で、無い／空文字が「未設定」を意味する。
 */
export const PLACE_META = {
  hand: { label: "手持ち" },
  cabin: { label: "機内スーツケース" },
  checked: { label: "スーツケース" },
};

/** 未設定を含む、選択肢として並べる順。画面の select がこの順で出る。 */
export const PLACE_KEYS = Object.keys(PLACE_META);

/** 何も無い状態の持ち物リスト。members の既定は篠崎家の 2 人。 */
export function emptyPacking() {
  return {
    members: { a: "雄一", b: "朱汰" },
    groups: [],
  };
}

/**
 * 既存と衝突しない id を採番する。
 *
 * 件数から作った候補が埋まっていれば次を試す。途中を削除したデータでは
 * 件数と最大値がずれるので、「使われていないこと」を必ず確かめる
 * （event-editor.js の nextEventId と同じ理由 ── id が重複すると、
 * チェックの切り替えが別の項目に飛ぶ）。
 */
function nextId(prefix, used) {
  for (let n = used.size + 1; ; n++) {
    const id = `${prefix}-${String(n).padStart(3, "0")}`;
    if (!used.has(id)) return id;
  }
}

export function nextGroupId(groups) {
  return nextId("g", new Set(groups.map((g) => g?.id)));
}

export function nextItemId(groups) {
  // 項目 id は区分をまたいで一意（packing-validate.js の validateItem 参照）
  return nextId("it", new Set(groups.flatMap((g) => (g?.items ?? []).map((i) => i?.id))));
}

/** 区分を差し替えた（同じ id が無ければ末尾に足した）新しいデータを返す。 */
export function withGroup(data, group) {
  const index = data.groups.findIndex((g) => g?.id === group.id);
  const groups =
    index === -1
      ? [...data.groups, group]
      : data.groups.map((g, i) => (i === index ? group : g));
  return { ...data, groups };
}

/** 区分を中身ごと取り除いた新しいデータを返す。 */
export function withoutGroup(data, groupId) {
  return { ...data, groups: data.groups.filter((g) => g?.id !== groupId) };
}

/**
 * 項目を差し替えた（同じ id が無ければ指定の区分の末尾に足した）新しいデータを返す。
 *
 * 差し替えは**元あった区分の中で**行う。groupId は新規追加の行き先としてだけ使う ──
 * 既存の項目を編集するたびに区分が移動したら、並べ替えた意味が消える。
 */
export function withItem(data, groupId, item) {
  const exists = data.groups.some((g) => g.items.some((i) => i?.id === item.id));
  if (exists) {
    return {
      ...data,
      groups: data.groups.map((g) => ({
        ...g,
        items: g.items.map((i) => (i?.id === item.id ? item : i)),
      })),
    };
  }
  return {
    ...data,
    groups: data.groups.map((g) =>
      g.id === groupId ? { ...g, items: [...g.items, item] } : g
    ),
  };
}

/** 項目を取り除いた新しいデータを返す（どの区分にあっても効く）。 */
export function withoutItem(data, itemId) {
  return {
    ...data,
    groups: data.groups.map((g) => ({
      ...g,
      items: g.items.filter((i) => i?.id !== itemId),
    })),
  };
}

/** 項目の居場所を探す。見つからなければ null。 */
function locate(groups, itemId) {
  for (let gi = 0; gi < groups.length; gi++) {
    const ii = groups[gi].items.findIndex((i) => i?.id === itemId);
    if (ii !== -1) return { gi, ii };
  }
  return null;
}

/**
 * 項目を 1 つ上（delta = -1）または下（delta = +1）へ動かす。
 *
 * 区分の端に達したら隣の区分へ送る（設計書 §7.3）。全体の先頭より上、
 * 全体の末尾より下へは動かさない ── そこで「動かない」ことは、
 * ボタンを押しても何も起きないという形で利用者に伝わる。
 *
 * 隣の区分が空でも送れる。空の区分を素通りさせると、押した回数と
 * 動いた距離が合わなくなり、どこへ行ったのかが分からなくなる。
 */
export function moveItem(data, itemId, delta) {
  const groups = data.groups;
  const at = locate(groups, itemId);
  if (at === null || (delta !== -1 && delta !== 1)) return data;

  const { gi, ii } = at;
  const item = groups[gi].items[ii];
  const target = ii + delta;

  // 同じ区分の中で収まる場合
  if (target >= 0 && target < groups[gi].items.length) {
    const items = [...groups[gi].items];
    items.splice(ii, 1);
    items.splice(target, 0, item);
    return { ...data, groups: groups.map((g, i) => (i === gi ? { ...g, items } : g)) };
  }

  // 端に達した。隣の区分へ送る
  const gTarget = gi + delta;
  if (gTarget < 0 || gTarget >= groups.length) return data; // 全体の端。動かさない

  return {
    ...data,
    groups: groups.map((g, i) => {
      if (i === gi) return { ...g, items: g.items.filter((x) => x?.id !== itemId) };
      if (i !== gTarget) return g;
      // 上へ送るなら受け入れ先の末尾、下へ送るなら先頭。
      // 「押した向きに 1 つ進む」が見た目と一致する置き方
      return { ...g, items: delta === -1 ? [...g.items, item] : [item, ...g.items] };
    }),
  };
}

/** 区分を 1 つ上（delta = -1）または下（delta = +1）へ動かす。 */
export function moveGroup(data, groupId, delta) {
  const index = data.groups.findIndex((g) => g?.id === groupId);
  if (index === -1 || (delta !== -1 && delta !== 1)) return data;

  const target = index + delta;
  if (target < 0 || target >= data.groups.length) return data;

  const groups = [...data.groups];
  const [group] = groups.splice(index, 1);
  groups.splice(target, 0, group);
  return { ...data, groups };
}

/**
 * 1 人分の進捗。
 *
 * total を分母に使う側（進捗バー）がゼロ除算にならないよう、件数をそのまま返して
 * 割り算は呼び出し側に任せる。項目が 1 つも無い状態は実際に起こる
 * （まだ何も足していないリスト）。
 *
 * その人に不要な項目は分母からも分子からも外す。
 * **分子からも外すこと** ── 不要にしても a / b の値は保持するので
 * （withNa 参照）、分子だけ残すと done > total が起こる。
 */
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

/**
 * 区分の進捗（達成数と件数）。区分見出しの `N / M` が読む。
 *
 * progressOf() と軸が違う ── あちらは「1 人分の分母」から不要な人を外すが、
 * こちらは「1 項目」を単位に数える。**その項目の done は、不要な人を除いた
 * 残り全員がチェック済みかどうか**で決める。`na: ["a","b"]`（全員不要）は
 * validateItem() が弾くので、残りが空集合になる心配はない。
 *
 * done をここで数え直さず `progressOf()` を呼ばないのは、`progressOf()` の
 * 単位が「人」で、区分見出しの単位が「項目」だから ── 人ごとの done を
 * 足し合わせても項目の完了数にはならない（1 人だけ詰め終わった項目を
 * 半分の 0.5 件として数えるような形になり、`N / M` が整数にならない）。
 */
export function groupProgressOf(group) {
  let done = 0;
  for (const item of group.items) {
    const required = ["a", "b"].filter((m) => !item.na?.includes(m));
    if (required.every((m) => item[m] === true)) done++;
  }
  return { done, total: group.items.length };
}

/**
 * 項目 1 件の「その人には不要」を切り替えた**新しい項目**を返す。
 * データ全体ではなく項目 1 件を受けるのは、呼び出し側が withItem() と
 * 組み合わせて使うため（cycleMember() と同じ形）。
 *
 * cycleMember() の内部から呼ばれるほか、単体でも export したままにしてある
 * （withNa 自体のテストが直接使うため）。
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

/**
 * 項目 1 件の、ある人の欄を次の状態へ進めた**新しい項目**を返す。
 *
 * ブランク → チェック → 不要 → ブランク … の 3 段階を 1 つのコントロールで
 * 回す（packing-render.js の人ごとの欄はモードに関わらずこの 1 関数だけで
 * 状態を決める。plans/packing-not-applicable.md「状態の遷移」）。
 *
 * **不要を抜けるときだけチェックも外す。** チェック → 不要のときは値を
 * 保持する（withNa と同じ理由 ── 間違えて不要にしても、以前のチェックが
 * 無傷で戻る）。不要 → ブランクは「ブランクの次はチェック」という見た目の
 * 約束に揃えるため、ここだけ値も外す。保持すると「ブランクに見えるのに
 * チェック済み」という、画面からは見えない食い違いが進捗の数字にだけ出る。
 */
export function cycleMember(item, member) {
  const notNeeded = item.na?.includes(member) === true;
  if (notNeeded) {
    return { ...withNa(item, member, false), [member]: false };
  }
  if (item[member] === true) {
    return withNa(item, member, true);
  }
  return { ...item, [member]: true };
}
