/**
 * 下書き（localStorage）とリモート（リポジトリの JSON）を束ねる層。
 *
 * 正はリポジトリの events.json。編集はまず手元に溜まり、トークンを持つ端末が
 * 「公開」でコミットする。読み込みは素の fetch で行う ── GitHub API を使うと
 * トークンを持たない端末が旅程を開けなくなるため。
 *
 * store と fetchImpl と now を注入するのは、この層のテストを Node で全部通すため。
 * config を引数に取るのは、owner / repo / branch / path に加えて draftKey / baseKey /
 * validate / commitMessage / codec もここ 1 か所にまとめるため（Phase B4 で追加。
 * 2 つ目の JSON を同期させるための注入口。詳しくは DEFAULT_CONFIG のコメント）。
 *
 * 設計書 §5.1〜§5.3 に対応。
 */

import { decideSync, toTime } from "./sync-decide.js";
import { createGitHub, GitHubError, CONFLICT_MESSAGE } from "./github.js";
import { validateEvents } from "./validate.js";
import { readToken } from "./token.js";
import { passthroughCodec, DecryptError } from "./crypto.js";
import { isPlainObject } from "./plain-object.js";

/**
 * 公開先と、ファイルごとに違う 6 つ。ここ以外に owner / repo / branch / path を書かないこと。
 *
 * path は 2 つの意味を兼ねている: 読み込みでは「ページからの相対 URL」、
 * Contents API では「リポジトリのルートからのパス」。今はページがリポジトリ直下に
 * 置かれているので一致している。ページをサブディレクトリへ移すなら分けること。
 *
 * draftKey / baseKey / validate / commitMessage / codec / noun は 2 つ目の JSON
 * （packing.json、comments.json）のために外へ出してある。**6 つは必ず揃えて渡すこと。**
 * 一部だけを差し替えると、その JSON が自分の検証を通ったうえで
 * store.write(draftKey, …) が旅程の既定キーへ書き、旅程の未公開の編集が
 * その瞬間に消える（設計書 §13）。
 *
 * noun だけは表示用で、取り違えてもデータは壊れない（「最新の旅程を確認できません」と
 * 持ち物ページで言うだけ）。それでも同じ組に入れてあるのは、
 * **揃えて渡す対象を「危険なものだけ」に絞ると、どれが危険かを毎回思い出す必要が
 * 生じるため** ── 全部まとめて渡す規則のほうが破りにくい。
 *
 * draftKey は下書き本体（events.json と同じ形の JSON）を書く localStorage のキー。
 * baseKey は最後に「リモートと揃えた」時刻を書くキーで、未公開の変更があるかの
 * 基準になる（`hasUnpublishedChanges()` 参照）。
 *
 * baseKey に入る時刻は公開した端末の時計で押される。押す端末が複数あるので、
 * 順序関係は保たれない ── A の時計が 10 分遅れていれば、A があとから公開した版の
 * updatedAt は B の版より古くなり、こちらの base（B の版を取り込んだ時刻）を
 * 下回る。突き合わせは「進んでいない」と判断し、A の公開を黙って上書きする。
 * 免疫を付けるには内容のハッシュか sha が要るが、読み込みはトークン無しの
 * 素の fetch なので sha が手に入らない（設計書 §13 の残存リスク）。
 * 上書きしてもコミットは git 履歴に残るので、復旧はできる。
 */
export const DEFAULT_CONFIG = {
  owner: "y-shinozaki",
  repo: "travel-plans",
  branch: "main",
  path: "assets/data/events.json",
  draftKey: "events",
  baseKey: "events-base",
  validate: validateEvents,
  commitMessage: (data) => {
    const count = data.events.length;
    return `Update itinerary from the browser (${count} event${count === 1 ? "" : "s"})`;
  },
  codec: passthroughCodec,
  noun: "旅程",
};

/**
 * updatedAt が読めないリモートを decideSync に渡すための値。
 *
 * null を渡すと decideSync は「リモートが取れなかった」＝ offline と判断する。
 * 取れているのに取れていないことにすると、画面は「最新の確認ができませんでした」と
 * 嘘をつく。時刻としては解釈できない値を渡せば、decideSync は
 * 「比較できないので人に選ばせる」側に倒れる。
 */
const UNCOMPARABLE = "";


/** ISO8601 の文字列だけを時刻として認める。 */
const stampOf = (data) => (typeof data?.updatedAt === "string" ? data.updatedAt : null);

export function createSync({
  store,
  fetchImpl = fetch,
  config = {},
  now = () => Date.now(),
}) {
  // 部分的な config でも owner / repo などの既定が落ちないよう、必ずスプレッドで重ねる。
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { draftKey, baseKey, validate, commitMessage, codec, noun } = cfg;
  const nowIso = () => new Date(now()).toISOString();

  /**
   * リモートの JSON を読む。認証なしの素の GET なので、トークンを持たない端末でも通る。
   *
   * 失敗は握らずに投げる。オフラインとして扱うかどうかは呼び出し側が決める
   * （load() は落とす、adoptRemote() は利用者に見せる）。
   *
   * HTTP の失敗には status を付ける。**404 は「取れなかった」ではなく
   * 「まだ作られていない」**で、持ち物リストのように最初の公開までファイルが
   * 存在しないページでは、それを空のリストとして扱う必要がある
   * （私は合言葉を入力できないので、暗号化した初期ファイルを用意できない）。
   * 通信断とパース失敗には status を付けない ── 付けると
   * 「404 かどうか」の判定が undefined との比較に化けて、静かに崩れる。
   */
  async function fetchRemote() {
    let response;
    try {
      // 公開直後に古い応答を掴むと「公開したのに反映されない」に見えるため no-store
      response = await fetchImpl(cfg.path, { cache: "no-store" });
    } catch (error) {
      throw new Error(`最新の${noun}データを取得できませんでした（通信に失敗しました）`, {
        cause: error,
      });
    }
    if (!response.ok) {
      const error = new Error(
        `最新の${noun}データを取得できませんでした（HTTP ${response.status}）`
      );
      error.status = response.status;
      throw error;
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`最新の${noun}データを JSON として読めませんでした`, { cause: error });
    }
  }

  /**
   * 取ってきた本文を復号する。平文（ct を持たない値）は素通しする ──
   * 切り替え当日にこの経路を 1 回だけ通る（設計書 §6.5）。
   *
   * DecryptError は握らずに投げる。「合言葉が違う」「壊れている」は
   * 直し方が違うので、呼び出し側が reason を見て文言を分ける（設計書 §9）。
   */
  async function fetchAndDecode() {
    return codec.decode(await fetchRemote());
  }

  /**
   * base（最後にリモートと揃えた updatedAt）を保存領域に書けなかったときの控え。
   *
   * 保存領域に書けない端末（プライベートブラウジング、容量超過）では base が
   * 一度も残らないので、assertRemoteNotAhead が毎回「取り込んだ証拠が無い」と
   * 判断して**公開が必ず 409 になる**。しかもその 409 に添える「取り込んでから
   * 公開し直す」も同じ理由で成立しない ── 出口の無い袋小路だった（設計書 §13）。
   *
   * このセッションの間だけ覚えておけば、少なくとも 2 回目以降の公開は通る。
   * **保存領域の代わりにはしない**（タブを閉じれば消える）。あくまで
   * 「さっき自分が公開した／取り込んだ」という、この場限りの記憶。
   */
  let sessionBase = null;

  /** base を読む。保存領域が使えない端末ではこのセッションの記憶に落ちる。 */
  const readBase = () => store.read(baseKey, null) ?? sessionBase;

  /**
   * 取り込みを書き込む。下書き → base の順で書く。
   *
   * 逆にすると、base だけ書けて下書きが書けなかったとき（容量超過など）に
   * 「古い下書きが最新と揃っている」ことになり、リモートの内容が静かに消える。
   * この順なら最悪でも次回に「新しい版があります」が出るだけで済む。
   *
   * **順序が非対称なので、失敗の意味も非対称になる。** 下書きで失敗したなら
   * 何も起きていない。base で失敗したなら**下書きだけは入れ替わっている** ──
   * 呼び出し側が「取り込めませんでした」と言って画面を古いまま据え置くと、
   * 保存領域にはリモートが入っているのに画面は前の内容、という食い違いが残り、
   * 次の編集がその古い内容を保存し直して取り込みを黙って巻き戻す。
   * それを見分けられるよう、base だけ失敗した場合は draftWritten を立てて投げる。
   */
  function storeAdopted(data) {
    const stamp = stampOf(data);
    // **保存より先に覚える。** ここへ来た時点で「この版を採る」判断は済んで
    // いるので、保存領域に書けたかどうかに関わらず、この端末はその版を
    // 見ている。書き込みの成否を待つと、1 バイトも書けない端末では
    // sessionBase が永久に埋まらず、公開が毎回 409 のままになる
    sessionBase = stamp;
    store.write(draftKey, data);
    // ここから先で失敗しても、下書きはもう入れ替わっている
    try {
      store.write(baseKey, stamp);
    } catch (error) {
      error.draftWritten = true;
      throw error;
    }
  }

  /**
   * 検証を通った下書きを読む。load() と readDraft() の両方が、下書きを
   * 「使えるかどうか」の判断先としてここ 1 か所だけを見る ── 2 か所に同じ検証を
   * 書くと、片方だけ直る事故が起きる（片方は投げる規則を変えたのにもう片方は
   * 古いまま、など）。
   *
   * 投げずに null へ落とすのは、投げると「localStorage を消すまでページが
   * 起動しない」状態になるため。保存されている値は消さない。中身を救い出す
   * 道を残しておく。
   *
   * @returns {{draft: object|null, rejected: boolean}} rejected は「保存は
   *   あったが検証に落ちた」場合だけ true。load() はこれを使って
   *   「取り込んでよいか（救出できる中身を上書きしないか）」を判断する。
   */
  function readValidDraft() {
    const stored = store.read(draftKey, null);
    if (!isPlainObject(stored)) return { draft: null, rejected: false };
    try {
      validate(stored);
      return { draft: stored, rejected: false };
    } catch (error) {
      console.warn(`sync: 手元の下書きが${noun}の形になっていないため使いません`, error);
      return { draft: null, rejected: true };
    }
  }

  /**
   * 検証を通った下書きを返す（無い・壊れているなら null）。
   *
   * load() が投げたあとの復旧経路のためにある。リモートの events.json が
   * 検証に落ちると load() は手元の下書きがどれだけ正しくても全端末で投げる ──
   * そのとき画面に公開ボタンがあっても state.data が空では押せない。
   * 手元に正しい下書きを持つ端末がそれを公開してリモートを直す、というのが
   * events.json の手編集を廃止したあとの唯一の復旧手段なので（設計書 §6.5）、
   * その端末が下書きに到達できる必要がある。
   */
  function readDraft() {
    return readValidDraft().draft;
  }

  /**
   * 起動時の 1 回。リモートを取り、下書きと突き合わせて、どちらを見せるかを返す。
   *
   * 返す source は decideSync の判断そのまま。画面の分岐は Task 9 側で行う。
   *
   * 返す outerStampMismatch は、封筒の外側の updatedAt（GCM の認証タグの外にあり、
   * 改竄も破損も検知できない ── crypto.js の isEnvelope 付近のコメント参照）と、
   * 復号できた中身の updatedAt が食い違っていたかを示す。これを無視することは、
   * 認証されていない外側の updatedAt を突き合わせ（assertRemoteNotAhead）に
   * 使い続けることを意味する。画面はこのフラグを見て、次に公開したときに
   * 外側が正しい値に上書きされることを利用者に伝えること（Task 9 側の役割）。
   */
  async function load() {
    const baseUpdatedAt = readBase();

    // 下書きも検証する。壊れたリモートを画面に出さないのに壊れた下書きは出す、
    // では筋が通らない。旅行の日数を減らせば、他の端末に残っている下書きは
    // まとめて範囲外になる ── 手で書き換えなくても起こることなので、
    // 「アプリ経由なら壊れない」とは言えない。
    const { draft, rejected: draftRejected } = readValidDraft();
    const hasLocal = draft !== null;

    // remote が使えるかは remoteOk で持つ。null をセンチネルにすると、
    // リモート本文がリテラルの null だったときに「取れなかった」と区別できない
    let remote = null;
    let remoteOk = false;
    let fetchError = null;
    let outerStampMismatch = false;
    try {
      const decoded = await fetchAndDecode();
      remote = decoded.data;
      outerStampMismatch = decoded.outerStampMismatch;
      remoteOk = true;
    } catch (error) {
      // 取りに行けなかっただけ。手元のデータで動作を続ける（設計書 §5.2）。
      // ただし復号の失敗は別物 ── リモートは取れていて中身が読めないので、
      // 「オフラインです」と言うのは嘘になる。そのまま投げて呼び出し側に見せる
      if (error instanceof DecryptError) throw error;
      fetchError = error;
      console.warn(`sync: 最新の${noun}データを確認できませんでした`, error);
    }

    // 検証は「見せるより前」。壊れたリモートを黙って画面に出さない。
    // ここで投げても store には触っていないので、手元の下書きは残る。
    if (remoteOk) validate(remote);

    const source = decideSync({
      remoteUpdatedAt: remoteOk ? (stampOf(remote) ?? UNCOMPARABLE) : null,
      localUpdatedAt: stampOf(draft),
      baseUpdatedAt,
      hasLocal,
    });

    if (source === "use-remote") {
      // 未公開の変更が無い（または下書きが無い）ときだけ静かに取り込む。
      // ただし下書きを弾いた場合は書かない。救出できる中身を上書きしてしまう
      if (draftRejected) {
        // **base だけは進める。** 画面に出ているのはリモートそのものなので、
        // 「このリモートを見た」のは事実。ここを飛ばすと base が古いままになり、
        // 次の公開が必ず 409 になる ── しかも公開しようとしている中身は
        // いま表示しているリモートと同じなので、止める理由が無い（設計書 §13）。
        // 下書きは触らない。救出できる中身はそのまま残す
        try {
          const stamp = stampOf(remote);
          sessionBase = stamp;
          store.write(baseKey, stamp);
        } catch (error) {
          console.warn("sync: base を更新できませんでした", error);
        }
      } else {
        try {
          storeAdopted(remote);
        } catch (error) {
          // 保存できなくても表示はできる。この取り込みは次回の判断を速くするための
          // 控えであって、旅程を見せる条件ではない。閲覧しかしない端末を
          // 保存領域の都合で締め出さない（保存が要る場面では saveLocal が投げる）
          console.warn("sync: 取り込んだ内容を保存できませんでした", error);
        }
      }
      return { data: remote, source, remoteUpdatedAt: stampOf(remote), outerStampMismatch };
    }

    // remote-is-newer でもリモートでは上書きしない。手元を見せたまま、
    // 取り込むかどうかを利用者に選ばせる（設計書 §5.2）
    if (hasLocal) {
      return { data: draft, source, remoteUpdatedAt: stampOf(remote), outerStampMismatch };
    }

    // ここに来るのは remoteOk が false のときだけ（リモートが取れていれば
    // 使える下書きが無い時点で decideSync は use-remote を返す）。つまり fetchError がある。
    // 見せるものが何もないので、原因をそのまま伝える
    throw fetchError;
  }

  /**
   * 未公開の変更があるか。
   *
   * decideSync の source では代用できない。use-local は「リモートが base より
   * 進んでいない」であって「手元に編集がある」ではない ── 一度も編集せず
   * ページを 2 回開いただけの端末が use-local になる（1 回目の use-remote で
   * storeAdopted が下書きと base を書くため）。source で判断すると、
   * その端末の公開ボタンが永久に「未公開の変更あり」を出し続ける。
   *
   * 時刻の大小ではなく一致で見る。base には storeAdopted が stampOf(data) を
   * そのまま入れるので、揃っている端末では必ず同じ文字列になり、時計の話が
   * 一切入らない。updatedAt を持たないデータ（どちらも null）も、それで
   * 正しく「揃っている」と出る。
   *
   * 同じ 2 つの値を `decideSync()`（sync-decide.js）も見ている。**同じ規則で見ること。**
   * 片方を大小に戻すと、時計がずれた端末で「未公開の変更あり」と表示しながら
   * 起動時には黙ってリモートで上書きする、という食い違いが生まれる。
   *
   * 下書きが無ければ false。公開するものが無い。
   */
  function hasUnpublishedChanges() {
    const draft = store.read(draftKey, null);
    if (!isPlainObject(draft)) return false;
    return stampOf(draft) !== readBase();
  }

  /**
   * 下書きを保存する。updatedAt を現在時刻に進めるのは、次回の load() で
   * 「未公開の変更がある」と判断できるようにするため。
   *
   * 保存前に検証するのは、ここが下書きの唯一の入口だから。通してしまうと
   * 「保存はできたが次の読み込みでページが起動しない」データが手元に残る。
   */
  function saveLocal(data) {
    validate(data);
    const stamped = { ...data, updatedAt: nowIso() };
    store.write(draftKey, stamped);
    return stamped;
  }

  /**
   * リモートを取り込み、下書きを捨てて base を揃える。
   * 失敗は投げる。押したのに何も起きないのが一番困る。
   *
   * validate(data) の戻り値は使わず、投げなければ data をそのまま採用する。
   * ここ以外の validate 呼び出し（load / saveLocal / publish）もすべて同じ
   * 「投げさせるためだけに呼ぶ」形にしている。既定の validateEvents はたまたま
   * data を返す（validate.js 参照）が、それを当てにすると、2 つ目の JSON 用に
   * 「不正なら投げる、正常なら何も返さない」という自然な検証器を書いた瞬間、
   * storeAdopted(undefined) が走って下書きにゴミを、base に null を書く ──
   * 「取り込む」を押したらリモートの内容が消える、という静かなデータ消失になる。
   */
  async function adoptRemote() {
    const { data } = await fetchAndDecode();
    validate(data);
    // base だけ書けなかった場合、下書きはもう入れ替わっている（storeAdopted の
    // コメント）。ここで投げっぱなしにすると呼び出し側は「取り込めませんでした」と
    // 出して画面を古いまま据え置き、次の編集がその古い内容を保存し直して
    // 取り込みを黙って巻き戻す。data を例外に載せて、画面だけは進めさせる
    try {
      storeAdopted(data);
    } catch (error) {
      if (error.draftWritten) error.adopted = data;
      throw error;
    }
    return data;
  }

  /**
   * GET した本文が、こちらが取り込んだ時点（base）より進んでいないかを見る。
   *
   * sha だけでは競合を捕まえられない。sha は PUT の直前に取り直すので、ほぼ常に
   * 最新であり、409 が返るのは GET と PUT の間に別の公開が挟まった数十ミリ秒だけ。
   * 現実の競合は「ページを開いて 30 分編集する間に相手が公開した」であり、
   * この間に sha は入れ替わっているが、公開の直前に取り直せば新しい sha が手に入り、
   * PUT は 201 で通ってしまう ── 相手の作業が黙って消える。
   *
   * decideSync の remote-is-newer は起動時にしか働かないので、ここで見るしかない。
   *
   * @returns {boolean} 突き合わせができたか。false は「見張りを外して公開した」
   *   という意味で、呼び出し側はそれを利用者に伝えること（console.warn だけだと、
   *   唯一ガードが効いていない場面を誰も知らないまま公開が済んでしまう）。
   */
  /**
   * GET した本文が、そもそも中身として使える形かを見る。
   *
   * 使えないと分かっている回に限り、突き合わせを飛ばして公開を通すためにある。
   * **リモートが検証を通らない状態は、409 で塞ぐと出口が無くなる**（設計書 §13）:
   * 409 の画面が示す唯一の逃げ道（「取り込む」→ adoptRemote）も同じ検証で
   * 落ちるので、その端末では直せない。手元に正しい下書きを持つ端末が
   * 上書きで直せるようにする ── events.json の手編集を廃止した以上、
   * ブラウザから直せる経路はこれしか残っていない（§6.5）。
   *
   * 上書きしてよいと判断できるのは「壊れている」と確かめられたときだけ。
   * 読めて検証も通るリモートは、これまでどおり突き合わせの対象にする。
   */
  async function remoteIsUsable(current) {
    if (current === null) return true; // ファイルがまだ無い
    try {
      const { data } = await codec.decode(JSON.parse(current.text));
      validate(data);
      return true;
    } catch (error) {
      console.warn(
        `sync: リモートの${noun}が検証を通らないため、公開前の突き合わせを省略します`,
        error
      );
      return false;
    }
  }

  function assertRemoteNotAhead(current) {
    if (current === null) return true; // ファイルがまだ無い。競合のしようがない

    let remoteStamp = null;
    try {
      remoteStamp = stampOf(JSON.parse(current.text));
    } catch {
      remoteStamp = null; // JSON として読めない
    }

    const remoteMs = toTime(remoteStamp);
    if (remoteMs === null) {
      // 比べようがない。止めずに通すのは、ここへ来られる壊れ方に限っては
      // 公開が復旧手段になるため ── validateEvents は updatedAt を見ないので、
      // days / events は正しいのに updatedAt だけ無い（または壊れている）
      // リモートはページとして普通に開き、公開ボタンも出る。その状態で公開すれば
      // publish() が正しい updatedAt を押し直し、次回から突き合わせが復活する。
      // ここで 409 にすると、その唯一の直し方まで塞いでしまう。
      //
      // 「リモートが壊れていれば何であれ公開で直せる」わけではない ── ただし
      // days / events の側が壊れていて load() のリモート検証が投げる場合も、
      // 公開ボタンとトークン設定は画面に出る（schedule.js は publishUI を
      // load() より前に組み立てる）。readDraft() が検証を通った下書きを
      // 返せば、手元に正しい下書きを持つ端末に限り、その下書きで実際に公開できる。
      // 手元に正しい下書きが無い端末だけが、リポジトリへの git コミットに頼ることになる。
      //
      // **この経路と outerStampMismatch は別物、混同しないこと。** ここは
      // remoteMs が null（updatedAt 自体が読めない）の場合の話で、下の
      // `remoteMs > baseMs` の分岐（outerStampMismatch が起こりうる側）とは
      // 独立している。外側の updatedAt が読めて base より進んでいる場合は
      // この if を素通りして下の分岐に入り 409 になる。readDraft() があっても
      // その 409 は公開では直せない ── 逃げ道の adoptRemote() 自体は通るが、
      // base に入るのは復号した**内側**の updatedAt なので（storeAdopted →
      // stampOf は内側を見る）、進んでいる外側は base を上回ったままで、
      // 次の公開も同じ 409 になる。
      // なお days / events そのものが壊れている場合は、adoptRemote() が
      // validate で落ちるので、そもそも逃げ道が使えない。壊れ方が違えば
      // 詰まり方も違う。
      console.warn("sync: リモートの updatedAt が読めないため、公開前の突き合わせを省略します");
      return false;
    }

    // base が無い ＝ このリモートを取り込んだ証拠がない。上書きしてよい根拠もない
    const baseMs = toTime(readBase());
    if (baseMs === null || remoteMs > baseMs) {
      throw new GitHubError(409, CONFLICT_MESSAGE);
    }
    return true;
  }

  /**
   * 公開する。順序が意味を持つ:
   *
   *   検証 → 時刻 → 暗号化 → GET で sha と本文 → 突き合わせ → PUT → base を更新
   *
   * 検証を後ろに回すと壊れたデータがリポジトリに入り、同行者のページが起動しなくなる。
   * base を PUT より前に進めると、失敗した公開が「同期済み」に見える。
   * 暗号化は検証と GET の間に固定の位置を持つ ── 検証より前に回すと壊れたデータを
   * 暗号文にしてしまい誰も中身を確かめられなくなる。GET より後ろに回す理由は無い
   * （突き合わせは暗号化しても無改造の assertRemoteNotAhead が読む、封筒の外側の
   * updatedAt を見るだけなので、暗号化の前後どちらに置いても動きは変わらないが、
   * 検証・時刻確定・暗号化はここでひとまとまりの「送る内容を作る」工程として揃えてある）。
   *
   * 競合（別端末が先に公開した）は握りつぶさない。突き合わせで見つけた場合も
   * サーバーが 409 を返した場合も、呼び出し側が「取り込んでから公開し直す」導線を
   * 出せるよう status 409 の GitHubError として投げ、下書きも base もそのまま残す。
   *
   * @returns {Promise<{commitUrl: string, conflictChecked: boolean}>}
   *   conflictChecked が false なら、突き合わせを省いて公開している
   *   （assertRemoteNotAhead を参照）。画面に出すこと。
   */
  async function publish(data) {
    validate(data);

    // トークンは公開のたびに読む。createSync のあとに設定しても効くように。
    // cfg をスプレッドで丸ごと渡さないのは、codec / validate などが
    // GitHub 層へ漏れないようにするため（あちらは owner / repo / branch / token /
    // fetchImpl しか知らなくてよい）
    const gh = createGitHub({
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
      token: readToken(store),
      fetchImpl,
    });

    const stamped = { ...data, updatedAt: nowIso() };
    // 暗号化は検証のあと。壊れたものを暗号文にすると、誰も中身を確かめられなくなる
    const envelope = await codec.encode(stamped);
    const text = `${JSON.stringify(envelope, null, 2)}\n`;
    const message = commitMessage(stamped);

    const current = await gh.getFile(cfg.path);
    // 送る前に突き合わせる。ここで投げれば PUT は一度も飛ばない。
    // 読むのは封筒の外側の updatedAt なので、暗号化しても無改造で効く（設計書 §6.2）
    //
    // ただしリモートが**中身として壊れている**と分かった回は飛ばす。
    // 塞ぐと直す手段が無くなるため（remoteIsUsable のコメント）
    const usable = await remoteIsUsable(current);
    const conflictChecked = usable ? assertRemoteNotAhead(current) : false;

    // ファイルがまだ無ければ sha なしで作成する（getFile は 404 で null を返す）
    const { commitUrl } = await gh.putFile({
      path: cfg.path,
      text,
      sha: current?.sha,
      message,
    });

    // PUT が通ってから手元を揃える。ここで投げる（保存領域に書けない端末）と
    // 「公開は済んでいるのに失敗として返る」ことになるが、握ると base が
    // 無いまま同期済みに見えてしまう。呼び出し側が StoreWriteError を
    // 「公開はできた／記録は残せなかった」と読み替える（publish-ui.js）。
    //
    // **commitUrl を例外に載せる。** 載せないと、控えを書けなかった端末には
    // コミットへのリンクが一切出せず、「公開できたのか」を確かめる手段が
    // リポジトリを自分で見に行くことだけになる（設計書 §13）。
    try {
      storeAdopted(stamped);
    } catch (error) {
      error.commitUrl = commitUrl;
      error.conflictChecked = conflictChecked;
      throw error;
    }
    return { commitUrl, conflictChecked };
  }

  return {
    load,
    saveLocal,
    adoptRemote,
    publish,
    hasUnpublishedChanges,
    readDraft,
    /**
     * 画面の文言に使う名詞。**publish-ui.js が自分の content.noun と
     * 突き合わせるためにある。** 両者は同じ値を別々に渡されており、
     * 結びつける仕組みが無かったので、B3 が片方だけ書き換えれば
     * 同期バーとステータスが違う名前を出すページができた ── どちらも
     * 例外を投げないので、テストで拾えなければ気付かれない（設計書 §13）。
     */
    noun,
  };
}
