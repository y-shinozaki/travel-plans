/**
 * スクロール連動の出現演出。
 *
 * IntersectionObserver 単体では、アンカージャンプやスクロール位置の復元で
 * 要素をひとまたぎしたときに is-in が付かず、コンテンツが opacity: 0 のまま
 * 永久に残る。threshold を 0 にしたうえで、スクロール時の掃引を併用する。
 */

export function initReveal(root = document) {
  /**
   * 対象は initReveal() を呼んだ時点の一度きりのスナップショット。
   * MutationObserver は使っていないので、あとから DOM に足した .reveal は
   * 永久に opacity: 0 のまま残る（誰も is-in を付けない）。
   *
   * Phase A では各ページの描画がすべて initReveal() より前に終わるので
   * 問題にならないが、Phase B の持ち物リストのように後から行が増える画面では
   * ここに当たる。そのときは足した要素に is-in を直接付けるか、
   * 描画のあとで initReveal() を呼び直すこと（返り値で前回を破棄してから）。
   */
  const pending = new Set(root.querySelectorAll(".reveal, .lines, .drawline"));
  if (!pending.size) return () => {};

  const show = (node) => {
    if (!pending.has(node)) return;
    node.classList.add("is-in");
    pending.delete(node);
    observer.unobserve(node);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) show(entry.target);
    },
    { threshold: 0, rootMargin: "0px 0px -40px 0px" }
  );
  for (const node of pending) observer.observe(node);

  // 取りこぼしの掃引。ビューポート下端より上に来た要素は無条件で表示する
  const sweep = () => {
    if (!pending.size) return;
    for (const node of [...pending]) {
      if (node.getBoundingClientRect().top < window.innerHeight - 40) show(node);
    }
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      sweep();
      ticking = false;
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", sweep, { passive: true });
  window.addEventListener("load", sweep);
  sweep();

  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", sweep);
    window.removeEventListener("load", sweep);
  };
}
