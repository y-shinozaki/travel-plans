import test from "node:test";
import assert from "node:assert/strict";
import { decideSync } from "../assets/js/sync-decide.js";

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
