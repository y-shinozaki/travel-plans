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

  // リモートが進んでいない。
  // ここは大小で比べてよい。remote も base も出所は同じ「リモートの updatedAt」で
  // （base は storeAdopted が stampOf(remote) をそのまま入れる）、同じ系列の値なので
  // 順序に意味がある。
  if (remote <= base) return "use-local";

  // ここから先はリモートが base より新しい。ローカルが触られているかで分かれる。
  //
  // こちらは大小ではなく一致で見る。base は公開した端末の時計で押された値、
  // local は saveLocal がこの端末の時計で押した値で、出所が違う。時計がずれていれば
  // 編集したのに local < base になり、大小で見ると「触られていない」と読めてしまう
  // ── そのまま use-remote に落ちると load() が storeAdopted() で下書きを上書きし、
  // トークンを持たない端末の編集がどこにも残らないまま消える（設計書 §5.2）。
  //
  // 揃っている端末では base と下書きの updatedAt は storeAdopted が書いた同じ文字列に
  // なる。saveLocal は必ず updatedAt を進めるので、「違う ＝ 編集された」で判断できる。
  // sync.js の hasUnpublishedChanges() が一致で見ているのと同じ理由。
  // 片方だけ大小に戻さないこと。
  return localUpdatedAt !== baseUpdatedAt ? "remote-is-newer" : "use-remote";
}
