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
import { createGitHub } from "./github.js";
import { validateEvents } from "./validate.js";
import { readToken } from "./token.js";

/** 下書き本体。 */
const DRAFT_KEY = "events";
/** 最後に「リモートと揃えた」時刻。未公開の変更があるかの基準になる。 */
const BASE_KEY = "events-base";

/** 公開先。ここ以外に owner / repo / branch / path を書かないこと。 */
export const DEFAULT_CONFIG = {
  owner: "y-shinozaki",
  repo: "travel-plans",
  branch: "main",
  path: "assets/data/events.json",
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

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** ISO8601 の文字列だけを時刻として認める。 */
const stampOf = (data) => (typeof data?.updatedAt === "string" ? data.updatedAt : null);

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
    const draft = store.read(DRAFT_KEY, null);
    const hasLocal = isPlainObject(draft);
    const baseUpdatedAt = store.read(BASE_KEY, null);

    let remote = null;
    let fetchError = null;
    try {
      remote = await fetchRemote();
    } catch (error) {
      // 取りに行けなかっただけ。手元のデータで動作を続ける（設計書 §5.2）
      fetchError = error;
      console.warn("sync: 最新の旅程データを確認できませんでした", error);
    }

    // 検証は「見せるより前」。壊れたリモートを黙って画面に出さない。
    // ここで投げても store には触っていないので、手元の下書きは残る。
    if (remote !== null) validateEvents(remote);

    const source = decideSync({
      remoteUpdatedAt: remote === null ? null : (stampOf(remote) ?? UNCOMPARABLE),
      localUpdatedAt: stampOf(draft),
      baseUpdatedAt,
      hasLocal,
    });

    if (source === "use-remote") {
      // 未公開の変更が無い（または下書きが無い）ときだけ静かに取り込む
      try {
        storeAdopted(remote);
      } catch (error) {
        // 保存できなくても表示はできる。この取り込みは次回の判断を速くするための
        // 控えであって、旅程を見せる条件ではない。閲覧しかしない端末を
        // 保存領域の都合で締め出さない（保存が要る場面では saveLocal が投げる）
        console.warn("sync: 取り込んだ内容を保存できませんでした", error);
      }
      return { data: remote, source, remoteUpdatedAt: stampOf(remote) };
    }

    // remote-is-newer でもリモートでは上書きしない。手元を見せたまま、
    // 取り込むかどうかを利用者に選ばせる（設計書 §5.2）
    if (hasLocal) return { data: draft, source, remoteUpdatedAt: stampOf(remote) };

    // ここに来るのは remote === null のときだけ（リモートが取れていれば
    // 下書きが無い時点で decideSync は use-remote を返す）。つまり fetchError がある。
    // オフラインで下書きも無い ＝ 見せるものが何もないので、原因をそのまま伝える
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
   * 公開する。順序が意味を持つ:
   *
   *   検証 → GET で sha → PUT → base を更新
   *
   * 検証を後ろに回すと壊れたデータがリポジトリに入り、同行者のページが起動しなくなる。
   * base を PUT より前に進めると、失敗した公開が「同期済み」に見える。
   *
   * 409（別端末が先に公開した）は握りつぶさない。呼び出し側が
   * 「取り込んでから公開し直す」導線を出せるよう、下書きも base もそのまま残す。
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
