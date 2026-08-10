/**
 * 旅程の読み込みに失敗したときの分類と文言。純粋関数だけを置く。
 *
 * schedule.js はモジュール冒頭で document を触るので Node から import できない。
 * ここに切り出すことで、「直し方が違う失敗は違う文言で言う」という約束を
 * node --test で守らせられる。
 *
 * 合言葉・鍵・トークンを文言に載せないこと（設計書 §9）。
 */

import { DataError } from "./data-error.js";
import { DecryptError } from "./crypto.js";

/** HTTP エラー・通信断。取りに行けなかった、という種類の失敗。 */
export class DataFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataFetchError";
  }
}

/** 取れたが JSON として読めなかった。404 が HTML で返る場合もここに来る。 */
export class DataParseError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "DataParseError";
  }
}

/**
 * @param {Error} error 読み込みで投げられたもの
 * @param {{noun?: string, path?: string}} [subject] どのデータの話か。
 *   既定は旅程 ── 呼び出し側を 1 つずつ直さなくても既存の挙動が変わらないようにしてある。
 *   持ち物ページは必ず自分の noun / path を渡すこと（渡さないと「旅程データを
 *   確認してください」と案内され、利用者は存在しないファイルを探すことになる）。
 */
export function classifyLoadError(
  error,
  { noun = "旅程", path = "assets/data/events.json" } = {}
) {
  const where = `${noun}データ（${path}）`;

  if (error instanceof DataError) {
    return {
      kind: "data",
      message:
        `${where}の内容に問題があります。\n` +
        "再読み込みでは直りません。下記を直してから読み込み直してください。\n\n" +
        error.message,
    };
  }

  if (error instanceof DecryptError) {
    if (error.reason === "wrong-key") {
      return {
        kind: "wrong-key",
        message:
          `この端末の合言葉では${noun}を開けません。\n` +
          "別の合言葉で暗号化されています。index.html に戻って入れ直してください。",
      };
    }
    // corrupt と malformed をまとめるのは、利用者から見た直し方が同じだから。
    // どちらも「合言葉は合っているのに中身が読めない」で、押す手は公開し直し
    return {
      kind: "corrupt",
      message:
        `${noun}データを復号できましたが、中身が壊れています。\n` +
        `合言葉は合っている見込みです。${noun}を持っている端末から公開し直してください。\n\n` +
        error.message,
    };
  }

  if (error instanceof DataParseError) {
    return {
      kind: "parse",
      message:
        `${where}を JSON として読めませんでした。\n` +
        "ファイルの書式（末尾のカンマ、閉じ括弧、クォート）を確認してください。\n" +
        "サーバーが JSON の代わりに HTML のエラーページを返している場合も" +
        "これになります。\n\n" +
        error.message,
    };
  }

  if (error instanceof DataFetchError) {
    return {
      kind: "fetch",
      message:
        `${where}を取得できませんでした。\n` +
        "通信状況を確認してページを再読み込みするか、" +
        "手元で開いている場合は file:// ではなくローカルサーバー" +
        "（python3 -m http.server）経由でアクセスしてください。\n\n" +
        error.message,
    };
  }

  return {
    kind: "unknown",
    message:
      `${noun}の表示中に想定外のエラーが発生しました。\n` +
      "データの読み込み自体は完了している可能性があります。" +
      "詳細はブラウザのコンソールを確認してください。\n\n" +
      `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
  };
}
