/**
 * Cursor encoding/decoding for list pagination
 */

/**
 * Internal structure for list pagination cursor
 */
export type InternalListCursor = {
  v: 1;
  prefix: string;
  after: string | null;
};

/**
 * Encode a cursor to a base64url string
 */
export function encodeCursor(c: InternalListCursor): string {
  const json = JSON.stringify(c);
  // base64url encoding
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Decode a cursor from a base64url string
 * @returns Decoded cursor or null if invalid
 */
export function decodeCursor(cursor: string): InternalListCursor | null {
  try {
    const b64 =
      cursor.replace(/-/g, "+").replace(/_/g, "/") +
      "===".slice((cursor.length + 3) % 4);
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json);
    if (!parsed || parsed.v !== 1 || typeof parsed.prefix !== "string")
      return null;
    if (parsed.after !== null && typeof parsed.after !== "string") return null;
    return parsed as InternalListCursor;
  } catch {
    return null;
  }
}
