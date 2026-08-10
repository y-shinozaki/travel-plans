/**
 * 旅程の読み込みに失敗したときの分類と文言。純粋関数だけを置く。
 *
 * schedule.js はモジュール冒頭で document を触るので Node から import できない。
 * ここに切り出すことで、「直し方が違う失敗は違う文言で言う」という約束を
 * node --test で守らせられる。
 *
 * 合言葉・鍵・トークンを文言に載せないこと（設計書 §9）。
 */

import { EventDataError } from "./validate.js";
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

export function classifyLoadError(error) {
  if (error instanceof EventDataError) {
    return {
      kind: "data",
      message:
        "旅程データ（assets/data/events.json）の内容に問題があります。\n" +
        "再読み込みでは直りません。下記を直してから読み込み直してください。\n\n" +
        error.message,
    };
  }

  if (error instanceof DecryptError) {
    if (error.reason === "wrong-key") {
      return {
        kind: "wrong-key",
        message:
          "この端末の合言葉では旅程を開けません。\n" +
          "別の合言葉で暗号化されています。index.html に戻って入れ直してください。",
      };
    }
    // corrupt と malformed をまとめるのは、利用者から見た直し方が同じだから。
    // どちらも「合言葉は合っているのに中身が読めない」で、押す手は公開し直し
    return {
      kind: "corrupt",
      message:
        "旅程データを復号できましたが、中身が壊れています。\n" +
        "合言葉は合っている見込みです。旅程を持っている端末から公開し直してください。\n\n" +
        error.message,
    };
  }

  if (error instanceof DataParseError) {
    return {
      kind: "parse",
      message:
        "旅程データ（assets/data/events.json）を JSON として読めませんでした。\n" +
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
        "旅程データ（assets/data/events.json）を取得できませんでした。\n" +
        "通信状況を確認してページを再読み込みするか、" +
        "手元で開いている場合は file:// ではなくローカルサーバー" +
        "（python3 -m http.server）経由でアクセスしてください。\n\n" +
        error.message,
    };
  }

  return {
    kind: "unknown",
    message:
      "旅程の表示中に想定外のエラーが発生しました。\n" +
      "データの読み込み自体は完了している可能性があります。" +
      "詳細はブラウザのコンソールを確認してください。\n\n" +
      `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
  };
}
