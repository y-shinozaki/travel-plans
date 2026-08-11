/**
 * ローカルの下書きとリモートの正、どちらを採るかを決める。
 *
 * I/O を持たないのは、全分岐をテストで押さえるため。
 * 迷ったときは「人に選ばせる」側に倒す。黙ってリモートで上書きすると
 * 同行者が手元で付けた変更が消えるため。
 *
 * 設計書 §5.2 に対応。
 */

/**
 * ISO8601 の文字列をミリ秒へ。比較できない値は null。
 * Date.parse は形が違うと NaN を返すので、そこで潰しておく。
 *
 * sync.js の assertRemoteNotAhead() も同じ判断（読めない updatedAt は null）で
 * 動く。両方に置くと片方だけ緩めたときに気付けないので、ここから import している。
 * この向き（sync.js → sync-decide.js）は decideSync の import と同じなので循環しない。
 */
export function toTime(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function decideSync({ remoteUpdatedAt, localUpdatedAt, baseUpdatedAt, hasLocal }) {
  // リモートが取れていない。手元にあるものを見せ続けるしかないので offline。
  // ここで use-local を返さないのは、「リモートを見に行けたが進んでいなかった」と
  // 「そもそも見に行けなかった」を画面が区別できなくなるため ── 前者は同期済み、
  // 後者は「最新かどうか分からない」で、人に伝えるべきことが違う。
  if (remoteUpdatedAt == null) return "offline";

  // 使える下書きが無い。守るべき手元の編集が存在しないので、黙ってリモートを
  // 採ってよい唯一の経路（この関数は原則「迷ったら人に聞く」に倒す）。
  if (!hasLocal) {
    // hasLocal が false なのに下書きの updatedAt が渡っているのは、呼び出し側の
    // 2 つの値が食い違っているということ。**どちらが正しいか、この関数には
    // 判断材料が無い。** そのまま use-remote を返すと、実際には下書きがある場合に
    // load() が storeAdopted() で上書きしてしまうので、人に選ばせる側へ倒す。
    if (localUpdatedAt != null) return "remote-is-newer";
    return "use-remote";
  }

  const remote = toTime(remoteUpdatedAt);
  const local = toTime(localUpdatedAt);
  const base = toTime(baseUpdatedAt);

  // 比較できないなら人に決めさせる
  if (remote == null || local == null) return "remote-is-newer";

  // base がない状態でローカルがあるのは異常系（取り込み前の編集など）。
  // 比較の基準がなく「未公開の変更がない」と断定できないので、選ばせる側に倒す。
  if (base == null) return "remote-is-newer";

  // リモートが進んでいない。
  // ここは大小で比べてよい。remote も base も「リモートファイルの updatedAt」という
  // 同じ系列の値だから（base に入るのは storeAdopted が渡された本文から取った
  // stampOf の値で、publish() 経由なら自端末の時計で押した直後の値だが、
  // それはそのまま PUT する本文の updatedAt でもある）。
  // ただし公開する端末が複数あって時計がずれていれば、この系列自体が単調でなくなる
  // ── 設計書 §13 の「時計ずれで他端末の公開を黙って上書きしうる」がそれ。
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
