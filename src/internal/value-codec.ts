/**
 * Value encoding/decoding for KV storage
 * Handles multiple formats: text, json, structured clone, and binary
 */

import type {
  KVGetType,
  KVValue,
  StoredEncoding,
  StoredRecord,
} from "../types";
import { isArrayBufferView } from "./validation";

/**
 * Sync path for encoding values - optimized for common cases like strings
 * @returns Encoded value or null if async handling required (ReadableStream)
 */
export function normalizePutValueSync(
  value: KVValue,
): { encoding: StoredEncoding; stored: unknown } | null {
  // Fast path for strings (no async needed)
  if (typeof value === "string") return { encoding: "text", stored: value };

  // Blob -> binary
  if (value instanceof Blob) return { encoding: "binary", stored: value };

  // ArrayBuffer / views -> binary Blob
  if (value instanceof ArrayBuffer)
    return { encoding: "binary", stored: new Blob([value]) };
  if (isArrayBufferView(value))
    return {
      encoding: "binary",
      stored: new Blob([value.buffer.slice(0) as ArrayBuffer]),
    };

  // ReadableStream requires async; return null to handle separately
  if (value instanceof ReadableStream) return null;

  // Default: structured clone (lets IndexedDB keep rich JS values without JSON serialization)
  return { encoding: "clone", stored: structuredClone(value) };
}

/**
 * Async wrapper for encoding values
 * Handles all value types including ReadableStream
 */
export async function normalizePutValue(
  value: KVValue,
): Promise<{ encoding: StoredEncoding; stored: unknown }> {
  // Try fast sync path first
  const syncResult = normalizePutValueSync(value);
  if (syncResult !== null) return syncResult;

  // Only ReadableStream reaches here
  const blob = await streamToBlob(value as ReadableStream<Uint8Array>);
  return { encoding: "binary", stored: blob };
}

/**
 * Convert a ReadableStream<Uint8Array> to a Blob
 */
async function streamToBlob(stream: ReadableStream<Uint8Array>): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
  return new Blob(chunks as BlobPart[]);
}

/**
 * Decode a stored record to the requested type
 * Returns decoded value or Blob sentinel for binary data requiring async conversion
 */
export function decodeValue(
  rec: StoredRecord,
  type: KVGetType | undefined,
): string | ArrayBuffer | ReadableStream<Uint8Array> | unknown {
  const want: KVGetType = type ?? "text";

  // Stored as text
  if (rec.encoding === "text") {
    const text = rec.value as string;
    if (want === "text") return text;
    if (want === "json") return JSON.parse(text); // allow "text" payload to be parsed if requested
    if (want === "arrayBuffer") {
      // encode string to UTF-8 bytes
      return new TextEncoder().encode(text).buffer;
    }
    // stream
    return new Blob([text]).stream() as ReadableStream<Uint8Array>;
  }

  // Stored as legacy json string
  if (rec.encoding === "json") {
    const jsonText = rec.value as string;
    if (want === "json") return JSON.parse(jsonText);
    if (want === "text") return jsonText; // raw JSON string as text
    if (want === "arrayBuffer")
      return new TextEncoder().encode(jsonText).buffer;
    return new Blob([jsonText]).stream() as ReadableStream<Uint8Array>;
  }

  // Stored as structured clone
  if (rec.encoding === "clone") {
    const cloned = rec.value;
    if (want === "json") return cloned;
    const jsonText = JSON.stringify(cloned);
    if (jsonText === undefined) {
      throw new TypeError("Stored value cannot be represented as JSON text");
    }
    if (want === "text") return jsonText;
    if (want === "arrayBuffer")
      return new TextEncoder().encode(jsonText).buffer;
    return new Blob([jsonText]).stream() as ReadableStream<Uint8Array>;
  }

  // Stored as binary blob
  const blob = rec.value as Blob;
  if (want === "stream") return blob.stream() as ReadableStream<Uint8Array>;
  if (want === "arrayBuffer") {
    // Return blob as sentinel; async conversion happens in get()
    return blob;
  }
  if (want === "json") {
    // Return blob as sentinel; async conversion happens in get()
    return blob;
  }
  // want text
  return blob; // sentinel
}

/**
 * Convert Blob to text
 */
export async function blobToText(blob: Blob): Promise<string> {
  return await blob.text();
}

/**
 * Convert Blob to ArrayBuffer
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return await blob.arrayBuffer();
}

/**
 * Convert Blob to JSON (parse as UTF-8 text then JSON)
 */
export async function blobToJson(blob: Blob): Promise<unknown> {
  const t = await blob.text();
  return JSON.parse(t);
}
