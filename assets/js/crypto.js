/**
 * 同期する JSON の暗号化と復号。設計書 §6.2 に対応。
 *
 * この層は store も DOM も fetch も知らない。鍵を受け取って封筒 JSON を作る／
 * 開けるだけで、鍵をどこに置くかは auth.js、いつ通すかは sync.js の担当。
 *
 * ファイルを「生バイト列」ではなく封筒 JSON にしているのは、B1 の競合検出を
 * 生かすため。sync.js の assertRemoteNotAhead() は GET した本文を JSON.parse して
 * updatedAt を読む。中身が不透明なバイト列だと読めず、突き合わせを省いたまま
 * 公開が通る ── 「相手が 30 分編集している間にこちらが公開する」という現実の競合を
 * 捕まえる唯一のガードが常時オフになる。updatedAt を暗号文の外に複製すれば、
 * 漏れるのは最終更新時刻だけで、行き先も時刻も宿も ct の中に残る。
 */

import { toBase64Bytes, fromBase64Bytes } from "./base64.js";

export const ITERATIONS = 600000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

/**
 * 復号できなかった。reason で直し方が変わるので、呼び出し側はこれで文言を分ける。
 *
 * - "wrong-key"  … 封筒の kdf が手元の鍵素材と違う。別の合言葉で暗号化されている
 * - "corrupt"    … kdf は一致するが GCM の認証タグ検証が失敗した。データが壊れている
 * - "malformed"  … base64 や JSON として読めない
 *
 * GCM 単体では「合言葉が違う」と「壊れている」を区別できない。kdf の一致で
 * 前者を切り分けているのは当て推量ではなく、手元の鍵素材との比較による。
 *
 * message に合言葉も鍵も載せないこと（設計書 §9）。
 */
export class DecryptError extends Error {
  constructor(reason, message, cause) {
    super(message, { cause });
    this.name = "DecryptError";
    this.reason = reason;
  }
}

const subtle = () => globalThis.crypto.subtle;

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 合言葉から AES-GCM の鍵を導出する。
 * extractable にしているのは auth.js が localStorage へ書き出すため
 * （書き出せないと端末ごとに毎回 PBKDF2 600,000 回を回すことになる）。
 */
export async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKeyBytes(key) {
  return new Uint8Array(await subtle().exportKey("raw", key));
}

export async function importKeyBytes(bytes) {
  return subtle().importKey("raw", bytes, "AES-GCM", true, ["encrypt", "decrypt"]);
}

/** 封筒か。ct を持つかどうかだけで見る。持たない値は平文として扱う。 */
export function isEnvelope(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.ct === "string"
  );
}

/**
 * 鍵素材から codec を組み立てる。
 *
 * salt / iterations をファイルの kdf からではなく引数で受けるのが要点。
 * ファイルごとにソルトを引くと、packing.json を足した時点で events.json と
 * 別の鍵になり、ページを移動するたびに PBKDF2 600,000 回が走る（設計書 §6.3）。
 */
export function createCodec({ key, salt, iterations = ITERATIONS, random = randomBytes }) {
  const saltB64 = toBase64Bytes(salt);

  async function encode(data) {
    const iv = random(IV_BYTES);
    const plain = new TextEncoder().encode(JSON.stringify(data));
    const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, plain);
    return {
      // 外側の updatedAt は認証されない複製。正は ct の中にある
      updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null,
      kdf: { salt: saltB64, iter: iterations },
      iv: toBase64Bytes(iv),
      ct: toBase64Bytes(new Uint8Array(ct)),
    };
  }

  async function decode(value) {
    // 平文はそのまま返す。切り替え当日にこの経路を 1 回だけ通る
    if (!isEnvelope(value)) return { data: value, outerStampMismatch: false };

    if (value.kdf?.salt !== saltB64 || value.kdf?.iter !== iterations) {
      throw new DecryptError("wrong-key", "別の合言葉で暗号化されています");
    }

    let iv;
    let ct;
    try {
      iv = fromBase64Bytes(value.iv);
      ct = fromBase64Bytes(value.ct);
    } catch (error) {
      throw new DecryptError("malformed", "暗号文の形式が壊れています", error);
    }

    let plain;
    try {
      plain = await subtle().decrypt({ name: "AES-GCM", iv }, key, ct);
    } catch (error) {
      // kdf は一致しているので、合言葉ではなく中身が壊れている見込み
      throw new DecryptError("corrupt", "データが壊れています", error);
    }

    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(plain));
    } catch (error) {
      throw new DecryptError("malformed", "復号できましたが JSON として読めません", error);
    }

    // 外側は GCM の認証タグの外なので、改竄も破損も検知できない。内側を正とする
    const outerStampMismatch = value.updatedAt !== (data?.updatedAt ?? null);
    return { data, outerStampMismatch };
  }

  return { encode, decode };
}

/**
 * 何もしない codec。createSync の既定値で、B1 までの挙動（平文で読み書き）を保つ。
 * 暗号化を有効にしていない経路とテストが、封筒を意識せずに済む。
 */
export const passthroughCodec = {
  async encode(data) {
    return data;
  },
  async decode(value) {
    return { data: value, outerStampMismatch: false };
  },
};
