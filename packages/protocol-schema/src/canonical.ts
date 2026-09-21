/**
 * IPC-JSON-1 — the canonical JSON profile of Intent Protocol (ADR-005, Commander R13).
 *
 * This is NOT RFC 8785 / JCS and must not be described as "JCS compatible": it is
 * stricter (integers only, NFC-required keys, no unpaired surrogates). Frozen rules —
 * changing any of these is a protocol-breaking change:
 *
 *  1. Object keys are sorted by raw UTF-16 code unit order.
 *  2. Keys whose value is `undefined` are omitted; `null` is preserved.
 *  3. String VALUES are NFC-normalized, then escaped per JSON.stringify
 *     (only `"`, `\` and control chars escaped; control chars use lowercase `\uXXXX`).
 *  4. Numbers MUST be safe integers (|n| <= 2^53-1). Floats, NaN, Infinity and -0 are rejected;
 *     monetary and decimal values MUST be carried as strings (see `Decimal`).
 *  5. Keys must already be NFC: a key whose NFC normalization differs from itself is REJECTED
 *     (never normalized, never merged).
 *  6. Unpaired UTF-16 surrogates are REJECTED in both keys and values.
 *  7. Arrays preserve order.
 *  8. No whitespace.
 */

export const CANONICAL_PROFILE = "IPC-JSON-1";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };

export class CanonicalizationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} at ${path || "$"}`);
    this.name = "CanonicalizationError";
  }
}

/** True if the string contains an unpaired UTF-16 surrogate. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { i++; continue; }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

function checkKey(k: string, path: string): void {
  if (hasLoneSurrogate(k)) throw new CanonicalizationError("unpaired surrogate in object key", path);
  if (k.normalize("NFC") !== k) throw new CanonicalizationError("object key is not NFC-normalized", path);
}

export function canonicalize(value: unknown): string {
  return serialize(value, "");
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      if (hasLoneSurrogate(value)) throw new CanonicalizationError("unpaired surrogate in string value", path);
      return JSON.stringify(value.normalize("NFC"));
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (Object.is(value, -0)) throw new CanonicalizationError("-0 is not allowed (0/-0 ambiguity)", path);
      if (!Number.isSafeInteger(value)) throw new CanonicalizationError("number must be a safe integer", path);
      return String(value);
    case "bigint":
      throw new CanonicalizationError("bigint not allowed; encode as string", path);
    case "undefined":
      throw new CanonicalizationError("undefined not allowed as a value", path);
    case "object":
      break;
    default:
      throw new CanonicalizationError(`unsupported type ${typeof value}`, path);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v, i) => serialize(v, `${path}[${i}]`)).join(",")}]`;
  }
  if (value instanceof Date || value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) {
    throw new CanonicalizationError("non-plain object not allowed", path);
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort(compareUtf16);
  // Keys must already be NFC — a non-NFC key would collide-or-split field
  // identity, so reject it rather than normalize (Commander ruling R1).
  for (const k of keys) checkKey(k, path);
  const parts = keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k], path ? `${path}.${k}` : k)}`);
  return `{${parts.join(",")}}`;
}

function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
