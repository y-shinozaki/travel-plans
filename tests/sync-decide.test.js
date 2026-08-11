import test from "node:test";
import assert from "node:assert/strict";
import { decideSync } from "../assets/js/sync-decide.js";

const T0 = "2026-08-09T08:00:00+09:00";
const T1 = "2026-08-09T10:00:00+09:00";
const T2 = "2026-08-09T12:00:00+09:00";
const T3 = "2026-08-09T14:00:00+09:00";

test("ローカルに何もなければリモートを使う", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: null, baseUpdatedAt: null, hasLocal: false }),
    "use-remote"
  );
});

test("リモートが取れなければ offline", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: null, localUpdatedAt: T1, baseUpdatedAt: T1, hasLocal: true }),
    "offline"
  );
});

test("リモートが取れずローカルもなければ offline", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: null, localUpdatedAt: null, baseUpdatedAt: null, hasLocal: false }),
    "offline"
  );
});

test("リモートが取り込んだ時点と同じならローカルを使う", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: T2, baseUpdatedAt: T1, hasLocal: true }),
    "use-local"
  );
});

test("リモートが進んでいて、ローカルに未公開の変更がなければ静かに取り込む", () => {
  // localUpdatedAt === baseUpdatedAt なら、ローカルは取り込んだまま触られていない
  assert.equal(
    decideSync({ remoteUpdatedAt: T2, localUpdatedAt: T1, baseUpdatedAt: T1, hasLocal: true }),
    "use-remote"
  );
});

test("リモートが進んでいて、ローカルにも未公開の変更があれば選ばせる", () => {
  assert.equal(
    decideSync({ remoteUpdatedAt: T3, localUpdatedAt: T2, baseUpdatedAt: T1, hasLocal: true }),
    "remote-is-newer"
  );
});

test("下書きが base より古くても、base と違えば未公開の変更として扱う", () => {
  // 時計のずれで起こる。公開する端末の時計が 10 分進んでいると、
  // その端末が押した updatedAt（＝こちらの base）は、こちらが saveLocal で
  // 押した下書きの updatedAt より新しくなる。
  //
  // 大小で見ると「下書きは base より古い＝触られていない」と読めてしまい、
  // リモートを黙って取り込んで下書きを消す。トークンを持たない側の端末では
  // 一度も公開していないので、消えた編集は git 履歴にも残っていない。
  //
  // base に入るのは storeAdopted が書いた updatedAt そのもの。揃っていれば
  // 必ず同じ文字列になるので、「違う＝ saveLocal が動いた」で判断できる。
  assert.equal(
    decideSync({ remoteUpdatedAt: T3, localUpdatedAt: T0, baseUpdatedAt: T2, hasLocal: true }),
    "remote-is-newer"
  );
});

test("ローカルの日時だけが不正でも remote-is-newer に倒す", () => {
  // リモートが読めるのにローカルが読めない場合。比較できない以上、
  // 黙って上書きするより人に決めさせる（リモート不正と同じ 1 行で処理している）。
  //
  // 2 つ目の assert は「リモートが進んでいない」形にしてある。ここを外すと
  // remote <= base の行に落ちて use-local になる ── 読めない updatedAt を持つ
  // 下書きを「揃っている」と扱ってしまうので、この形でないと不正判定の穴を検出できない。
  assert.equal(
    decideSync({ remoteUpdatedAt: T2, localUpdatedAt: "いつか", baseUpdatedAt: T1, hasLocal: true }),
    "remote-is-newer"
  );
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: "いつか", baseUpdatedAt: T1, hasLocal: true }),
    "remote-is-newer"
  );
});

test("リモートが古い場合はローカルを使う", () => {
  // 自分が公開した直後に Pages の反映が追いつかず、古い版が返ることがある
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: T3, baseUpdatedAt: T3, hasLocal: true }),
    "use-local"
  );
});

test("base がないのにローカルがある場合は未公開の変更として扱う", () => {
  // 取り込み前に編集した、base を消した、などの異常系。
  // 黙ってリモートで上書きすると編集が消えるので、選ばせる側に倒す。
  assert.equal(
    decideSync({ remoteUpdatedAt: T2, localUpdatedAt: T1, baseUpdatedAt: null, hasLocal: true }),
    "remote-is-newer"
  );
});

test("不正な日時は remote-is-newer に倒す", () => {
  // 比較できない以上、黙って上書きするより人に決めさせる
  assert.equal(
    decideSync({ remoteUpdatedAt: "いつか", localUpdatedAt: T1, baseUpdatedAt: T1, hasLocal: true }),
    "remote-is-newer"
  );
});

test("hasLocal が false なのにローカルの updatedAt が来たら人に選ばせる", () => {
  // 呼び出し側の 2 つの値が食い違っている。どちらが正しいかは決められないので、
  // 黙って use-remote（＝下書きを上書きしうる側）へは倒さない。
  // この関数で唯一「迷ったら人に聞く」に倒れていなかった経路（設計書 §13）。
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: T0, baseUpdatedAt: T0, hasLocal: false }),
    "remote-is-newer"
  );
});

test("hasLocal が false でローカルの updatedAt も無ければ、これまでどおり use-remote", () => {
  // 上の分岐が広すぎないことの番人。食い違っていない呼び出しまで
  // remote-is-newer に倒すと、初回起動のたびにバーが出る
  assert.equal(
    decideSync({ remoteUpdatedAt: T1, localUpdatedAt: null, baseUpdatedAt: T0, hasLocal: false }),
    "use-remote"
  );
});
