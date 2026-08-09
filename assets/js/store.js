/**
 * localStorage の薄いラッパ。
 *
 * backend を差し替えられるようにしてあるのは Node でテストするため。
 * 直接 localStorage を触ると、この層のテストが書けない。
 *
 * 読み出しは「壊れていても落とさない」、書き込みは「失敗したら必ず知らせる」方針。
 * 読めない値は既定値に戻せば動き続けられるが、書けなかったことを黙って握ると
 * ユーザーは保存できたと思ったまま編集を失う。
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

  return { read, write, remove, has };
}
