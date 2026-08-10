/**
 * Pointer Events による並べ替え。
 *
 * HTML5 Drag & Drop は使わない ── タッチ端末で動かないため（設計書 §7.3）。
 * ドラッグが使えない環境のために ↑↓ ボタンを常に併設してあるので、
 * ここが動かなくても並べ替えはできる。
 *
 * 並び順は **DOM を正**とする。指を離した時点で data-id を読んで配列を
 * 組み直す（ドラッグ中に再描画しないので動きが途切れない）。
 * 組み直しの部分（rebuildFromOrder）は DOM を知らない純粋関数にしてあり、
 * node --test で押さえてある ── 「移動したら項目が消えた」は、
 * 次にそのリストを見るまで誰も気付かない類の壊れ方だから。
 */

/**
 * DOM から読んだ並び順でデータを組み直す。
 *
 * **order に載っていない区分・項目は落とさない。** DOM の読み取りが
 * 取りこぼしても（描画が途中で失敗した、別のタブで保存された、など）
 * 項目が黙って消えないようにするため。order にあるものを先に、
 * 無いものを元の順のまま後ろに置く。
 *
 * 知らない id は無視する。実体を持たない id を並べても項目は生まれない。
 *
 * @param {object} data 現在の持ち物データ
 * @param {{id:string, itemIds:string[]}[]} order DOM から読んだ並び
 * @returns {object} 新しいデータ
 */
export function rebuildFromOrder(data, order) {
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  // 項目は区分をまたいで一意なので、1 つの表で引ける
  const itemById = new Map(
    data.groups.flatMap((g) => g.items.map((item) => [item.id, item]))
  );

  const placedGroups = new Set();
  const placedItems = new Set();

  const groups = [];
  for (const entry of order) {
    const group = groupById.get(entry?.id);
    if (!group || placedGroups.has(group.id)) continue;
    placedGroups.add(group.id);

    const items = [];
    for (const itemId of entry.itemIds ?? []) {
      const item = itemById.get(itemId);
      if (!item || placedItems.has(itemId)) continue;
      placedItems.add(itemId);
      items.push(item);
    }
    groups.push({ ...group, items });
  }

  // order に載らなかった区分を、元の順のまま後ろへ。中身は空にしておき、
  // 取りこぼした項目は下のループで元の区分へ戻す
  for (const group of data.groups) {
    if (placedGroups.has(group.id)) continue;
    placedGroups.add(group.id);
    groups.push({ ...group, items: [] });
  }

  // order に載らなかった項目を、元あった区分の末尾へ戻す
  const indexOfGroup = new Map(groups.map((g, i) => [g.id, i]));
  for (const original of data.groups) {
    for (const item of original.items) {
      if (placedItems.has(item.id)) continue;
      placedItems.add(item.id);
      const at = indexOfGroup.get(original.id);
      if (at === undefined) {
        // 到達不能（上の 2 つのループが data.groups の id を必ず 1 度ずつ置くため）。
        // それでも continue にしないのは、万一この不変条件が壊れたときに
        // 項目が黙って消えるのが、このモジュールが防ぐために在るバグそのものだから。
        throw new Error(`packing-drag: 区分 ${original.id} を索引できませんでした`);
      }
      groups[at] = { ...groups[at], items: [...groups[at].items, item] };
    }
  }

  return { ...data, groups };
}

/** ドラッグ中の行に付ける印。CSS 側（packing.css）が見る。 */
const DRAGGING_CLASS = "is-dragging";

/**
 * 現在の DOM から並び順を読む。
 * 区分は [data-group-id]、項目は [data-item-id] を持つ想定
 * （packing-render.js が付ける）。
 */
function readOrder(root) {
  return [...root.querySelectorAll("[data-group-id]")].map((groupEl) => ({
    id: groupEl.dataset.groupId,
    itemIds: [...groupEl.querySelectorAll("[data-item-id]")].map((el) => el.dataset.itemId),
  }));
}

/**
 * ドラッグを配線する。
 *
 * @param {object} deps
 * @param {HTMLElement} deps.root 表全体。ここから querySelectorAll で並びを読む
 * @param {() => object} deps.getData 現在の持ち物データ
 * @param {(data:object) => void} deps.commit 組み直した結果を保存して描き直す
 * @param {(error: Error) => void} [deps.onError] rebuildFromOrder() が投げたときの逃げ道。
 *   ここで拾わないと、投げた例外は pointerup のリスナの外に出られず
 *   コンソールにしか残らない ── rebuildFromOrder のコメントにあるとおり、
 *   その throw は「項目が黙って消える」ことを防ぐためにわざと大声にしてある。
 *   このコールバックが無いと、その大声を聞くのがコンソールを見た人だけになり、
 *   画面の前の利用者には何も伝わらない（packing.js の setNotice へ渡す想定）
 * @returns {{detach: () => void}}
 */
export function attachDrag({ root, getData, commit, onError }) {
  let dragging = null; // { row, placeholderAfter }

  function onPointerDown(event) {
    const handle = event.target.closest?.("[data-drag-handle]");
    if (!handle || event.button > 0) return;
    const row = handle.closest("[data-item-id]");
    if (!row) return;

    event.preventDefault();
    dragging = { row };
    row.classList.add(DRAGGING_CLASS);

    // capture は補助。失敗する環境があるので握って続ける
    // （pointermove / pointerup は window に付けてあるので、capture が
    // 効かなくてもポインタがハンドルから外れた時点で止まることはない）
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* 効かない環境では window のリスナだけで動かす */
    }
  }

  /**
   * ポインタの真下にある行の前後どちらへ差し込むかを決めて、その場で DOM を動かす。
   * データはまだ触らない ── 指を離すまで再描画しないので、動きが途切れない。
   */
  function onPointerMove(event) {
    if (!dragging) return;
    event.preventDefault();

    const under = document.elementFromPoint(event.clientX, event.clientY);
    const target = under?.closest?.("[data-item-id]");
    if (target && target !== dragging.row) {
      const box = target.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      target.parentNode.insertBefore(dragging.row, after ? target.nextSibling : target);
      return;
    }

    // 空の区分の上に来たとき。行が 1 つも無いので elementFromPoint では拾えない
    const emptyGroup = under?.closest?.("[data-item-list]");
    if (emptyGroup && !emptyGroup.querySelector("[data-item-id]")) {
      emptyGroup.appendChild(dragging.row);
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging.row.classList.remove(DRAGGING_CLASS);
    dragging = null;
    // ここで初めてデータを組み直す。DOM が正
    try {
      commit(rebuildFromOrder(getData(), readOrder(root)));
    } catch (error) {
      // rebuildFromOrder の throw をここで止めないと、pointerup のリスナの
      // 外に出て console にしか残らない。commit（= packing.js の apply）は
      // 保存の失敗（検査・保存領域）しか拾わない ── 組み直し自体の失敗は
      // commit を呼ぶ前に起きるので、apply の try/catch の外側になる
      onError?.(error);
    }
  }

  root.addEventListener("pointerdown", onPointerDown);
  // ハンドルではなく window に付ける。setPointerCapture が失敗する環境で、
  // ポインタがハンドルから外れた瞬間にドラッグが止まるため（設計書 §7.3）
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  return {
    detach() {
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
