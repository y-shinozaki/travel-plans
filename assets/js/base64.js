/**
 * UTF-8 文字列 ⇄ base64。
 *
 * GitHub Contents API はファイル内容を base64 で受け取る。
 * btoa() は Latin-1 しか扱えず、日本語を渡すと InvalidCharacterError になる。
 * 旅程データは日本語だらけなので、専用に切ってある。
 *
 * バイト列を 1 文字ずつ足すのは、String.fromCharCode(...bytes) だと
 * 引数が多すぎて長い入力で RangeError になるため。
 */

export function toBase64Utf8(text) {
  if (typeof text !== "string") {
    throw new TypeError(`toBase64Utf8: 文字列ではありません: ${typeof text}`);
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64Utf8(b64) {
  if (typeof b64 !== "string") {
    throw new TypeError(`fromBase64Utf8: 文字列ではありません: ${typeof b64}`);
  }
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
