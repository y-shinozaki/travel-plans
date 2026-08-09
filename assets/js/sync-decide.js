/**
 * ローカルの下書きとリモートの正、どちらを採るかを決める。
 *
 * I/O を持たないのは、全分岐をテストで押さえるため。
 * 迷ったときは「人に選ばせる」側に倒す。黙ってリモートで上書きすると
 * 同行者が手元で付けた変更が消えるため。
 *
 * 設計書 §5.2 に対応。
 */

function toTime(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function decideSync({ remoteUpdatedAt, localUpdatedAt, baseUpdatedAt, hasLocal }) {
  if (remoteUpdatedAt == null) return "offline";
  if (!hasLocal) return "use-remote";

  const remote = toTime(remoteUpdatedAt);
  const local = toTime(localUpdatedAt);
  const base = toTime(baseUpdatedAt);

  // 比較できないなら人に決めさせる
  if (remote == null || local == null) return "remote-is-newer";

  // base がない状態でローカルがあるのは異常系（取り込み前の編集など）。
  // 比較の基準がなく「未公開の変更がない」と断定できないので、選ばせる側に倒す。
  if (base == null) return "remote-is-newer";

  // リモートが進んでいない
  if (remote <= base) return "use-local";

  // ここから先はリモートが base より新しい。ローカルが触られているかで分かれる
  return local > base ? "remote-is-newer" : "use-remote";
}
