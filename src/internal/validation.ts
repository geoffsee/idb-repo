/**
 * Type guards and validation utilities for KV storage
 */

/**
 * Type guard to check if a value is an ArrayBufferView (TypedArray, DataView, etc.)
 */
export function isArrayBufferView(v: unknown): v is ArrayBufferView {
  return (
    !!v &&
    typeof v === "object" &&
    "buffer" in (v as any) &&
    (v as any).buffer instanceof ArrayBuffer
  );
}

/**
 * Validate and assert that a key is a non-empty string
 * @throws {TypeError} if key is invalid
 */
export function assertKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("KV key must be a non-empty string");
  }
}
