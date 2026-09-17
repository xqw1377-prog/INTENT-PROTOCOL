/**
 * INDEPENDENT reference canonical JSON serializer (Builder B).
 *
 * Written exclusively from the protocol's written rules (canonical.ts header /
 * ADR-005 "Canonical JSON + domain-separated hash" / architecture doc §6.1):
 *
 *   R1. Object keys are sorted by UTF-16 code unit order.
 *   R2. Keys whose value is `undefined` are omitted; `null` is preserved.
 *   R3. Strings are NFC-normalized before serialization and escaped per
 *       JSON.stringify (only `"`, `\` and C0 control chars; controls as
 *       lowercase `\uXXXX`).
 *   R4. Numbers MUST be safe integers (|n| <= 2^53-1). Floats, NaN, Infinity
 *       and -0 are rejected.
 *   R5. Arrays preserve order.
 *   R6. No whitespace.
 *
 * This module MUST NOT import anything from @intent/protocol-schema. It shares
 * no code with the implementation under test; agreement between the two is the
 * conformance signal, disagreement is a finding.
 *
 * Additional rule this reference enforces (derived, required for the output to
 * be a well-defined canonical form):
 *
 *   R7. After NFC normalization two keys of the same object MUST NOT collide;
 *       a collision would produce duplicate keys in the canonical text and an
 *       ambiguous hash input, so it is rejected.
 */

export class RefCanonicalizationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} at ${path || "$"}`);
    this.name = "RefCanonicalizationError";
  }
}

export function refCanonicalize(value: unknown): string {
  return ser(value, "$");
}

function ser(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string") return jsonString(value.normalize("NFC"));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    // R4, literal reading: reject -0 explicitly.
    if (Object.is(value, -0)) throw new RefCanonicalizationError("-0 is not a permitted number", path);
    if (!Number.isSafeInteger(value)) {
      throw new RefCanonicalizationError(`number must be a safe integer, got ${value}`, path);
    }
    return value.toString();
  }
  if (typeof value === "bigint" || typeof value === "undefined" || typeof value === "symbol" || typeof value === "function") {
    throw new RefCanonicalizationError(`${typeof value} is not serializable`, path);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((e, i) => ser(e, `${path}[${i}]`)).join(",") + "]";
  }
  if (value instanceof Date || value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) {
    throw new RefCanonicalizationError("non-plain object is not serializable", path);
  }
  const obj = value as Record<string, unknown>;
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const rawKey of Object.keys(obj)) {
    if (obj[rawKey] === undefined) continue; // R2
    const key = rawKey.normalize("NFC"); // R3 applies to keys as strings too
    if (seen.has(key)) {
      // R7: two distinct raw keys collapsing onto one normalized key would
      // emit duplicate keys — ambiguous canonical text.
      throw new RefCanonicalizationError(`key collides after NFC normalization: ${JSON.stringify(key)}`, path);
    }
    seen.add(key);
    entries.push([key, ser(obj[rawKey], path === "$" ? key : `${path}.${rawKey}`)]);
  }
  entries.sort((a, b) => compareUtf16(a[0], b[0])); // R1
  return "{" + entries.map(([k, v]) => `${jsonString(k)}:${v}`).join(",") + "}";
}

/** Compare by UTF-16 code units (NOT code points). */
export function compareUtf16(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/** JSON string quoting: escape `"`, `\`, C0 controls as lowercase \uXXXX, and
 *  (per JSON.stringify semantics, ES2019 well-formed stringify) lone surrogates. */
function jsonString(s: string): string {
  let out = '"';
  for (const ch of s) {
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch.charCodeAt(0) < 0x20) out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    else if (isLoneSurrogate(ch)) out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

function isLoneSurrogate(ch: string): boolean {
  const c = ch.charCodeAt(0);
  // for..of yields surrogate PAIRS as a single 2-unit string, so a 1-unit string
  // in the surrogate range is by construction unpaired.
  return ch.length === 1 && c >= 0xd800 && c <= 0xdfff;
}
