/**
 * localStorage の薄いラッパ。
 *
 * backend を差し替えられるようにしてあるのは Node でテストするため。
 * 直接 localStorage を触ると、この層のテストが書けない。
 *
 * 読み出しは「壊れていても落とさない」、書き込みは「失敗したら必ず知らせる」方針。
 * 読めない値は既定値に戻せば動き続けられるが、書けなかったことを黙って握ると
 * ユーザーは保存できたと思ったまま編集を失う。
 *
 * JSON を通す read / write のほかに、生の文字列を扱う readText / writeText を持つ。
 * トークンのような「ログにも例外文にも出してはいけない値」のためにある。
 * read は壊れた値を JSON.parse に掛けるので、SyntaxError の文言に中身の先頭が
 * 埋め込まれ、それが console.warn へ出てしまう。
 */

const PREFIX = "tp:";

export class StoreWriteError extends Error {
  constructor(key, cause) {
    super(`${key} を保存できませんでした（保存領域の空きが足りない可能性があります）`);
    this.name = "StoreWriteError";
    this.cause = cause;
  }
}

export function createStore(backend = globalThis.localStorage) {
  const fullKey = (key) => PREFIX + key;

  function read(key, fallback) {
    let raw;
    try {
      raw = backend.getItem(fullKey(key));
    } catch (error) {
      console.warn(`${fullKey(key)} を読めませんでした`, error);
      return fallback;
    }
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`${fullKey(key)} の中身が壊れていたため既定値に戻します`, error);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      backend.setItem(fullKey(key), JSON.stringify(value));
    } catch (error) {
      throw new StoreWriteError(fullKey(key), error);
    }
  }

  /**
   * JSON として解釈せず、入っている文字列をそのまま返す（無ければ null）。
   *
   * 中身を一切ログに出さないのが read との違い。read は壊れた値の中身を
   * SyntaxError 経由で console.warn に載せるため、秘密には使えない。
   */
  function readText(key) {
    try {
      return backend.getItem(fullKey(key));
    } catch (error) {
      // error は getItem の失敗（プライベートブラウジングなど）で、値は含まない
      console.warn(`${fullKey(key)} を読めませんでした`, error);
      return null;
    }
  }

  /** 文字列をそのまま書く。失敗は write と同じく StoreWriteError で知らせる。 */
  function writeText(key, value) {
    try {
      backend.setItem(fullKey(key), String(value));
    } catch (error) {
      // StoreWriteError の文言はキー名だけ。値は載せない
      throw new StoreWriteError(fullKey(key), error);
    }
  }

  function remove(key) {
    try {
      backend.removeItem(fullKey(key));
    } catch (error) {
      console.warn(`${fullKey(key)} を削除できませんでした`, error);
    }
  }

  function has(key) {
    try {
      return backend.getItem(fullKey(key)) != null;
    } catch {
      return false;
    }
  }

  return { read, write, readText, writeText, remove, has };
}
