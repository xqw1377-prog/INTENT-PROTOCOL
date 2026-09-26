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
export declare const CANONICAL_PROFILE = "IPC-JSON-1";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue | undefined;
};
export declare class CanonicalizationError extends Error {
    readonly path: string;
    constructor(message: string, path: string);
}
export declare function canonicalize(value: unknown): string;
export declare function canonicalBytes(value: unknown): Uint8Array;
//# sourceMappingURL=canonical.d.ts.map