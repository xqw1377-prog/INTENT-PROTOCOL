import { z } from "zod";
import { HASH_RE, type Hash } from "./hash.js";

/** `sha256:<64 hex>` — parses to the branded `Hash` template type. */
export const HashSchema = z.string().regex(HASH_RE, "expected sha256:<64 lowercase hex>").transform((s) => s as Hash);
export const UUIDSchema = z.string().uuid();
/** RFC 3339 UTC timestamp with millisecond precision and a real calendar date, e.g. 2026-09-17T00:00:00.000Z */
export const TimestampSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "expected ISO-8601 UTC ms timestamp")
  .refine((s) => {
    const d = new Date(s);
    return !Number.isNaN(d.getTime()) && d.toISOString() === s;
  }, "calendar-invalid timestamp");
/**
 * Monetary/decimal values are strings in NON-NEGATIVE CANONICAL form
 * (Commander ruling): unique representation only —
 * legal:  "0", "10", "1.1", "0.01"
 * illegal: "1.10", "1.0", "-0", "00", "01", ".5", "1."
 * Regex: integer part has no leading zeros; optional fraction must not end in 0.
 */
export const DecimalSchema = z.string().regex(/^(0|[1-9]\d*)(\.\d*[1-9])?$/, "expected non-negative canonical decimal");
export const U32Schema = z.number().int().min(0).max(0xffffffff);
/** u64 as decimal string, range-checked (must be hashable via u64be). */
export const U64Schema = z.string().regex(/^(0|[1-9]\d*)$/, "expected u64 as decimal string")
  .refine((s) => BigInt(s) <= 0xffffffffffffffffn, "u64 overflow");

/**
 * SubjectRef: `<kind>:<id>` — the only way protocol objects reference a principal (§13).
 * Product identity and chain address are separate; a wallet is a binding, not a subject.
 */
export const SubjectKind = z.enum(["user", "org", "agent", "verifier", "arbitrator", "service", "operator"]);
export type SubjectKind = z.infer<typeof SubjectKind>;
export const SubjectRefSchema = z.string().regex(/^(user|org|agent|verifier|arbitrator|service|operator):[A-Za-z0-9._@-]{1,128}$/);
export type SubjectRef = z.infer<typeof SubjectRefSchema>;

/** Reference to a content-addressed policy document. */
export const HashRefSchema = z.object({ uri: z.string().min(1), hash: HashSchema }).strict();
export type HashRef = z.infer<typeof HashRefSchema>;

export const AssetRefSchema = z.object({
  /** e.g. "evm:8453" (CAIP-2 style) or "fiat:USD" or "sim:local" */
  network: z.string().min(1),
  /** contract address / currency code / "native" */
  asset: z.string().min(1),
  decimals: z.number().int().min(0).max(36),
}).strict();
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const SignatureSchema = z.object({
  scheme: z.enum(["ed25519", "secp256k1", "eip191", "eip712", "passkey-p256"]),
  signer: SubjectRefSchema,
  key_id: z.string().min(1),
  value: z.string().min(1),
}).strict();
export type Signature = z.infer<typeof SignatureSchema>;

/** §9 risk levels. Authorization is computed by Policy Engine, never by model output. */
export const RiskLevel = z.enum(["L0", "L1", "L2", "L3"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** §8.1 Evidence Assurance Levels. E0 never triggers funds. */
export const EvidenceLevel = z.enum(["E0", "E1", "E2", "E3"]);
export type EvidenceLevel = z.infer<typeof EvidenceLevel>;

/** §14 data classification. RESTRICTED never enters model context or logs. */
export const PrivacyClass = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);
export type PrivacyClass = z.infer<typeof PrivacyClass>;
