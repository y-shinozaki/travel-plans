/**
 * 合言葉から導いた鍵の置き場所。crypto.js の上に載るだけの薄い層。
 * token.js と同じ形にしてある（設計書 §6.3、§5.4）。
 *
 * ここに閉じ込める理由も token.js と同じ 2 つ。
 *
 * 1. キー名（`tp:key`）を 1 か所にする
 * 2. 秘密の出口を 1 か所にする。読んだ値は crypto.js の importKeyBytes にしか渡さない。
 *    ログにも DOM にも例外文にも出さないこと
 *
 * store.read / write ではなく readText / writeText を使うのも同じ理由で、
 * read は壊れた値を JSON.parse に掛けるので SyntaxError の文言に中身の先頭が
 * 埋め込まれ、それが console.warn へ出る。区切り文字に "." を使うのは
 * base64 が "+/=" は含んでも "." は含まないため（JSON を通さずに 3 つを詰められる）。
 *
 * 鍵は sessionStorage ではなく localStorage に置く。タブを閉じるたびに再入力に
 * なると、旅行中の現地で「合言葉を忘れた」が起きやすい ── 端末盗難より
 * そちらのほうが現実的な危険だと判断した（設計書 §6.3）。
 */

import {
  ITERATIONS,
  SALT_BYTES,
  createCodec,
  deriveKey,
  exportKeyBytes,
  importKeyBytes,
  randomBytes,
} from "./crypto.js";
import { toBase64Bytes, fromBase64Bytes } from "./base64.js";

const KEY = "key";

/** 使える鍵素材だけを返す（無い・壊れているなら null）。 */
export function readKeyMaterial(store) {
  const raw = store.readText(KEY);
  if (typeof raw !== "string" || raw === "") return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  const [salt, iterText, key] = parts;
  const iter = Number(iterText);
  if (!salt || !key || !Number.isInteger(iter) || iter <= 0) return null;

  return { salt, iter, key };
}

export function writeKeyMaterial(store, { salt, iter, key }) {
  store.writeText(KEY, `${salt}.${iter}.${key}`);
}

export function clearKey(store) {
  store.remove(KEY);
}

/** 遷移ガードの判断に使う。store.has ではなく中身で見る（壊れた値を「有る」にしない）。 */
export function hasKey(store) {
  return readKeyMaterial(store) !== null;
}

/**
 * 封筒の kdf が手元の鍵素材と一致するか。
 *
 * 「合言葉が違う」と「データが壊れている」を見分けるために使う（設計書 §9）。
 * kdf が無い値（＝平文）は突き合わせるものが無いので true を返す ──
 * 移行前のファイルを「別の合言葉」と誤って言わないため。
 */
export function kdfMatches(store, kdf) {
  if (kdf == null) return true;
  const material = readKeyMaterial(store);
  if (material === null) return false;
  return kdf.salt === material.salt && kdf.iter === material.iter;
}

/**
 * 合言葉を鍵に変えて保存し、codec を返す。
 *
 * kdf が null なら新しいソルトを生成する。これを通るのは、まだ平文のファイルに
 * 対して初めて合言葉を設定するとき（切り替え当日の 1 回）だけ。
 */
export async function unlock(store, passphrase, kdf) {
  const salt = kdf?.salt ? fromBase64Bytes(kdf.salt) : randomBytes(SALT_BYTES);
  const iterations = kdf?.iter ?? ITERATIONS;

  const key = await deriveKey(passphrase, salt, iterations);
  writeKeyMaterial(store, {
    salt: toBase64Bytes(salt),
    iter: iterations,
    key: toBase64Bytes(await exportKeyBytes(key)),
  });

  return createCodec({ key, salt, iterations });
}

/**
 * 保存済みの鍵から codec を組み立てる（無ければ null）。
 * PBKDF2 はここでは走らない。それが鍵をキャッシュしている理由。
 *
 * 形は正しいが base64 として壊れている値を扱うときも null を返す。
 * readKeyMaterial は形しか検査していないので、fromBase64Bytes が例外を投げるかもしれない。
 * store.js の read() が JSON.parse の失敗を既定値に落としているのと同じ形にする。
 */
export async function loadCodec(store) {
  const material = readKeyMaterial(store);
  if (material === null) return null;

  try {
    const salt = fromBase64Bytes(material.salt);
    const key = await importKeyBytes(fromBase64Bytes(material.key));
    return createCodec({ key, salt, iterations: material.iter });
  } catch {
    // base64 デコード失敗、または crypto 操作失敗 → null に落とす
    return null;
  }
}
