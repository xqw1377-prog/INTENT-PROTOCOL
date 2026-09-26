import { z } from "zod";
/** `sha256:<64 hex>` — parses to the branded `Hash` template type. */
export declare const HashSchema: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
/** UUID in canonical form: lowercase hex, standard hyphenated 8-4-4-4-12 (R11). */
export declare const UUIDSchema: z.ZodString;
/** RFC 3339 UTC timestamp with millisecond precision and a real calendar date, e.g. 2026-09-17T00:00:00.000Z */
export declare const TimestampSchema: z.ZodEffects<z.ZodString, string, string>;
/**
 * Monetary/decimal values are strings in NON-NEGATIVE CANONICAL form
 * (Commander ruling): unique representation only —
 * legal:  "0", "10", "1.1", "0.01"
 * illegal: "1.10", "1.0", "-0", "00", "01", ".5", "1."
 * Regex: integer part has no leading zeros; optional fraction must not end in 0.
 */
export declare const DecimalSchema: z.ZodString;
export declare const U32Schema: z.ZodNumber;
/** u64 as decimal string, range-checked (must be hashable via u64be). */
export declare const U64Schema: z.ZodEffects<z.ZodString, string, string>;
/**
 * SubjectRef: `<kind>:<id>` — the only way protocol objects reference a principal (§13).
 * Product identity and chain address are separate; a wallet is a binding, not a subject.
 */
export declare const SubjectKind: z.ZodEnum<["user", "org", "agent", "verifier", "arbitrator", "service", "operator"]>;
export type SubjectKind = z.infer<typeof SubjectKind>;
export declare const SubjectRefSchema: z.ZodString;
export type SubjectRef = z.infer<typeof SubjectRefSchema>;
/** Reference to a content-addressed policy document. */
export declare const HashRefSchema: z.ZodObject<{
    uri: z.ZodString;
    hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
}, "strict", z.ZodTypeAny, {
    uri: string;
    hash: `sha256:${string}`;
}, {
    uri: string;
    hash: string;
}>;
export type HashRef = z.infer<typeof HashRefSchema>;
export declare const AssetRefSchema: z.ZodObject<{
    /** Opaque network/namespace label resolved by the settlement adapter; the schema layer asserts no chain-id semantics. */
    network: z.ZodString;
    /** Asset identifier within that network (contract address, currency code, "native", …). */
    asset: z.ZodString;
    decimals: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    network: string;
    asset: string;
    decimals: number;
}, {
    network: string;
    asset: string;
    decimals: number;
}>;
export type AssetRef = z.infer<typeof AssetRefSchema>;
export declare const SignatureSchema: z.ZodObject<{
    scheme: z.ZodEnum<["ed25519", "secp256k1", "eip191", "eip712", "passkey-p256"]>;
    signer: z.ZodString;
    key_id: z.ZodString;
    value: z.ZodString;
}, "strict", z.ZodTypeAny, {
    value: string;
    scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
    signer: string;
    key_id: string;
}, {
    value: string;
    scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
    signer: string;
    key_id: string;
}>;
export type Signature = z.infer<typeof SignatureSchema>;
/** §9 risk levels. Authorization is computed by Policy Engine, never by model output. */
export declare const RiskLevel: z.ZodEnum<["L0", "L1", "L2", "L3"]>;
export type RiskLevel = z.infer<typeof RiskLevel>;
/** §8.1 Evidence Assurance Levels. E0 never triggers funds. */
export declare const EvidenceLevel: z.ZodEnum<["E0", "E1", "E2", "E3"]>;
export type EvidenceLevel = z.infer<typeof EvidenceLevel>;
/** §14 data classification. RESTRICTED never enters model context or logs. */
export declare const PrivacyClass: z.ZodEnum<["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]>;
export type PrivacyClass = z.infer<typeof PrivacyClass>;
//# sourceMappingURL=primitives.d.ts.map