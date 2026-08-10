/**
 * UTF-8 文字列 ⇄ base64、およびバイト列 ⇄ base64。
 *
 * GitHub Contents API はファイル内容を base64 で受け取る。
 * btoa() は Latin-1 しか扱えず、日本語を渡すと InvalidCharacterError になる。
 * 旅程データは日本語だらけなので、専用に切ってある。
 *
 * バイト列を 1 文字ずつ足すのは、String.fromCharCode(...bytes) だと
 * 引数が多すぎて長い入力で RangeError になるため。
 *
 * バイト列側の 2 つは Phase B4 で足した。ソルト・IV・暗号文は文字列ではないので
 * UTF-8 版を通せない（TextDecoder が不正なバイト列を U+FFFD に潰す）。
 * 1 文字ずつ足すループをこの 1 か所に閉じ込めるため、UTF-8 版をその上に載せている。
 */

export function toBase64Bytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(`toBase64Bytes: Uint8Array ではありません: ${typeof bytes}`);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64Bytes(b64) {
  if (typeof b64 !== "string") {
    throw new TypeError(`fromBase64Bytes: 文字列ではありません: ${typeof b64}`);
  }
  const binary = atob(b64);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

export function toBase64Utf8(text) {
  if (typeof text !== "string") {
    throw new TypeError(`toBase64Utf8: 文字列ではありません: ${typeof text}`);
  }
  return toBase64Bytes(new TextEncoder().encode(text));
}

export function fromBase64Utf8(b64) {
  if (typeof b64 !== "string") {
    throw new TypeError(`fromBase64Utf8: 文字列ではありません: ${typeof b64}`);
  }
  return new TextDecoder().decode(fromBase64Bytes(b64));
}
