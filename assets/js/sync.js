/**
 * 下書き（localStorage）とリモート（リポジトリの JSON）を束ねる層。
 *
 * 正はリポジトリの events.json。編集はまず手元に溜まり、トークンを持つ端末が
 * 「公開」でコミットする。読み込みは素の fetch で行う ── GitHub API を使うと
 * トークンを持たない端末が旅程を開けなくなるため。
 *
 * store と fetchImpl と now を注入するのは、この層のテストを Node で全部通すため。
 * config を引数に取るのは、owner / repo / branch / path をここ 1 か所にまとめるため。
 *
 * 設計書 §5.1〜§5.3 に対応。
 */

import { decideSync } from "./sync-decide.js";
import { createGitHub, GitHubError } from "./github.js";
import { validateEvents } from "./validate.js";
import { readToken } from "./token.js";

/** 下書き本体。 */
const DRAFT_KEY = "events";
/**
 * 最後に「リモートと揃えた」時刻。未公開の変更があるかの基準になる。
 *
 * 時刻はすべて公開した端末の時計で押される。端末間で時計が大きくずれていると
 * 判断もずれるが、比較するのは「同じ 1 つのリモート値」と「それを取り込んだ控え」
 * なので、ずれても順序関係は保たれる（設計どおり）。
 */
const BASE_KEY = "events-base";

/**
 * 公開先。ここ以外に owner / repo / branch / path を書かないこと。
 *
 * path は 2 つの意味を兼ねている: 読み込みでは「ページからの相対 URL」、
 * Contents API では「リポジトリのルートからのパス」。今はページがリポジトリ直下に
 * 置かれているので一致している。ページをサブディレクトリへ移すなら分けること。
 */
export const DEFAULT_CONFIG = {
  owner: "y-shinozaki",
  repo: "travel-plans",
  branch: "main",
  path: "assets/data/events.json",
};

/**
 * 「リモートが進んでいるので公開できない」を伝える文言。
 * github.js が HTTP 409 に付ける文言と揃えてある。呼び出し側から見て
 * 「別の端末が先に公開した」は同じ出来事で、次にすることも同じ（取り込んでやり直す）。
 */
const CONFLICT_MESSAGE = "リモートが更新されています。取り込んでから公開し直してください";

/**
 * updatedAt が読めないリモートを decideSync に渡すための値。
 *
 * null を渡すと decideSync は「リモートが取れなかった」＝ offline と判断する。
 * 取れているのに取れていないことにすると、画面は「最新の確認ができませんでした」と
 * 嘘をつく。時刻としては解釈できない値を渡せば、decideSync は
 * 「比較できないので人に選ばせる」側に倒れる。
 */
const UNCOMPARABLE = "";

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** ISO8601 の文字列だけを時刻として認める。 */
const stampOf = (data) => (typeof data?.updatedAt === "string" ? data.updatedAt : null);

/** 比較できない値は null。Date.parse は形が違うと NaN を返す。 */
function toTime(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function createSync({
  store,
  fetchImpl = fetch,
  config = DEFAULT_CONFIG,
  now = () => Date.now(),
}) {
  const nowIso = () => new Date(now()).toISOString();

  /**
   * リモートの JSON を読む。認証なしの素の GET なので、トークンを持たない端末でも通る。
   *
   * 失敗は握らずに投げる。オフラインとして扱うかどうかは呼び出し側が決める
   * （load() は落とす、adoptRemote() は利用者に見せる）。
   */
  async function fetchRemote() {
    let response;
    try {
      // 公開直後に古い応答を掴むと「公開したのに反映されない」に見えるため no-store
      response = await fetchImpl(config.path, { cache: "no-store" });
    } catch (error) {
      throw new Error("最新の旅程データを取得できませんでした（通信に失敗しました）", {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new Error(`最新の旅程データを取得できませんでした（HTTP ${response.status}）`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error("最新の旅程データを JSON として読めませんでした", { cause: error });
    }
  }

  /**
   * 取り込みを書き込む。下書き → base の順で書く。
   *
   * 逆にすると、base だけ書けて下書きが書けなかったとき（容量超過など）に
   * 「古い下書きが最新と揃っている」ことになり、リモートの内容が静かに消える。
   * この順なら最悪でも次回に「新しい版があります」が出るだけで済む。
   */
  function storeAdopted(data) {
    store.write(DRAFT_KEY, data);
    store.write(BASE_KEY, stampOf(data));
  }

  /**
   * 起動時の 1 回。リモートを取り、下書きと突き合わせて、どちらを見せるかを返す。
   *
   * 返す source は decideSync の判断そのまま。画面の分岐は Task 9 側で行う。
   */
  async function load() {
    const stored = store.read(DRAFT_KEY, null);
    const baseUpdatedAt = store.read(BASE_KEY, null);

    // 下書きも検証する。壊れたリモートを画面に出さないのに壊れた下書きは出す、
    // では筋が通らない。旅行の日数を減らせば、他の端末に残っている下書きは
    // まとめて範囲外になる ── 手で書き換えなくても起こることなので、
    // 「アプリ経由なら壊れない」とは言えない。
    //
    // 投げずにリモートへ落とすのは、投げると「localStorage を消すまで
    // ページが起動しない」状態になるため。保存されている値は消さない。
    // 中身を救い出す道を残しておく。
    let draft = isPlainObject(stored) ? stored : null;
    let draftRejected = false;
    if (draft !== null) {
      try {
        validateEvents(draft);
      } catch (error) {
        console.warn("sync: 手元の下書きが旅程の形になっていないため使いません", error);
        draft = null;
        draftRejected = true;
      }
    }
    const hasLocal = draft !== null;

    // remote が使えるかは remoteOk で持つ。null をセンチネルにすると、
    // リモート本文がリテラルの null だったときに「取れなかった」と区別できない
    let remote = null;
    let remoteOk = false;
    let fetchError = null;
    try {
      remote = await fetchRemote();
      remoteOk = true;
    } catch (error) {
      // 取りに行けなかっただけ。手元のデータで動作を続ける（設計書 §5.2）
      fetchError = error;
      console.warn("sync: 最新の旅程データを確認できませんでした", error);
    }

    // 検証は「見せるより前」。壊れたリモートを黙って画面に出さない。
    // ここで投げても store には触っていないので、手元の下書きは残る。
    if (remoteOk) validateEvents(remote);

    const source = decideSync({
      remoteUpdatedAt: remoteOk ? (stampOf(remote) ?? UNCOMPARABLE) : null,
      localUpdatedAt: stampOf(draft),
      baseUpdatedAt,
      hasLocal,
    });

    if (source === "use-remote") {
      // 未公開の変更が無い（または下書きが無い）ときだけ静かに取り込む。
      // ただし下書きを弾いた場合は書かない。救出できる中身を上書きしてしまう
      if (!draftRejected) {
        try {
          storeAdopted(remote);
        } catch (error) {
          // 保存できなくても表示はできる。この取り込みは次回の判断を速くするための
          // 控えであって、旅程を見せる条件ではない。閲覧しかしない端末を
          // 保存領域の都合で締め出さない（保存が要る場面では saveLocal が投げる）
          console.warn("sync: 取り込んだ内容を保存できませんでした", error);
        }
      }
      return { data: remote, source, remoteUpdatedAt: stampOf(remote) };
    }

    // remote-is-newer でもリモートでは上書きしない。手元を見せたまま、
    // 取り込むかどうかを利用者に選ばせる（設計書 §5.2）
    if (hasLocal) return { data: draft, source, remoteUpdatedAt: stampOf(remote) };

    // ここに来るのは remoteOk が false のときだけ（リモートが取れていれば
    // 使える下書きが無い時点で decideSync は use-remote を返す）。つまり fetchError がある。
    // 見せるものが何もないので、原因をそのまま伝える
    throw fetchError;
  }

  /**
   * 下書きを保存する。updatedAt を現在時刻に進めるのは、次回の load() で
   * 「未公開の変更がある」と判断できるようにするため。
   *
   * 保存前に検証するのは、ここが下書きの唯一の入口だから。通してしまうと
   * 「保存はできたが次の読み込みでページが起動しない」データが手元に残る。
   */
  function saveLocal(data) {
    validateEvents(data);
    const stamped = { ...data, updatedAt: nowIso() };
    store.write(DRAFT_KEY, stamped);
    return stamped;
  }

  /**
   * リモートを取り込み、下書きを捨てて base を揃える。
   * 失敗は投げる。押したのに何も起きないのが一番困る。
   */
  async function adoptRemote() {
    const remote = validateEvents(await fetchRemote());
    storeAdopted(remote);
    return remote;
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
   */
  function assertRemoteNotAhead(current) {
    if (current === null) return; // ファイルがまだ無い。競合のしようがない

    let remoteStamp = null;
    try {
      remoteStamp = stampOf(JSON.parse(current.text));
    } catch {
      remoteStamp = null; // JSON として読めない
    }

    const remoteMs = toTime(remoteStamp);
    if (remoteMs === null) {
      // 比べようがない。ここで止めると、リモートが壊れているときに
      // ブラウザから直せなくなる（公開こそが復旧手段になる）ので通す
      console.warn("sync: リモートの updatedAt が読めないため、公開前の突き合わせを省略します");
      return;
    }

    // base が無い ＝ このリモートを取り込んだ証拠がない。上書きしてよい根拠もない
    const baseMs = toTime(store.read(BASE_KEY, null));
    if (baseMs === null || remoteMs > baseMs) {
      throw new GitHubError(409, CONFLICT_MESSAGE);
    }
  }

  /**
   * 公開する。順序が意味を持つ:
   *
   *   検証 → GET で sha と本文 → 突き合わせ → PUT → base を更新
   *
   * 検証を後ろに回すと壊れたデータがリポジトリに入り、同行者のページが起動しなくなる。
   * base を PUT より前に進めると、失敗した公開が「同期済み」に見える。
   *
   * 競合（別端末が先に公開した）は握りつぶさない。突き合わせで見つけた場合も
   * サーバーが 409 を返した場合も、呼び出し側が「取り込んでから公開し直す」導線を
   * 出せるよう status 409 の GitHubError として投げ、下書きも base もそのまま残す。
   */
  async function publish(data) {
    validateEvents(data);

    // トークンは公開のたびに読む。createSync のあとに設定しても効くように
    const gh = createGitHub({ ...config, token: readToken(store), fetchImpl });

    const stamped = { ...data, updatedAt: nowIso() };
    const text = `${JSON.stringify(stamped, null, 2)}\n`;
    const count = stamped.events.length;
    const message = `Update itinerary from the browser (${count} event${count === 1 ? "" : "s"})`;

    const current = await gh.getFile(config.path);
    // 送る前に突き合わせる。ここで投げれば PUT は一度も飛ばない
    assertRemoteNotAhead(current);

    // ファイルがまだ無ければ sha なしで作成する（getFile は 404 で null を返す）
    const { commitUrl } = await gh.putFile({
      path: config.path,
      text,
      sha: current?.sha,
      message,
    });

    // PUT が通ってから手元を揃える
    storeAdopted(stamped);
    return { commitUrl };
  }

  return { load, saveLocal, adoptRemote, publish };
}
