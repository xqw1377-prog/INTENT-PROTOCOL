/**
 * Canonical JSON (ADR-005).
 *
 * Frozen rules — changing any of these is a protocol-breaking change:
 *  1. Object keys are sorted by UTF-16 code unit order (RFC 8785 / JCS compatible).
 *  2. Keys whose value is `undefined` are omitted; `null` is preserved.
 *  3. Strings are NFC-normalized before serialization and escaped per JSON.stringify
 *     (only `"`, `\` and control chars are escaped; control chars use lowercase `\uXXXX`).
 *  4. Numbers MUST be safe integers (|n| <= 2^53-1). Floats, NaN, Infinity and -0 are rejected;
 *     monetary and decimal values MUST be carried as strings (see `Decimal`).
 *  5. Arrays preserve order.
 *  6. No whitespace.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };

export class CanonicalizationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} at ${path || "$"}`);
    this.name = "CanonicalizationError";
  }
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
      return JSON.stringify(value.normalize("NFC"));
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new CanonicalizationError("number must be a safe integer", path);
      return String(value === 0 ? 0 : value);
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
  const parts = keys.map((k) => `${JSON.stringify(k.normalize("NFC"))}:${serialize(obj[k], path ? `${path}.${k}` : k)}`);
  return `{${parts.join(",")}}`;
}

function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
