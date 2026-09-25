/**
 * GP3 formal verifier independent primitives — V2.
 * FORMAL_TARGET = e73969f (security-frozen after key rotation).
 * ZERO imports from gp3-verification.
 */
import { execFileSync } from "node:child_process";
import { createHash, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const FORMAL_TARGET = "e73969f527de5cb590f874690b14b3c25a4448f6";
export const BASE_SHA = "5a72525413431dc04f039df9cf01842083bb8db0";
export const GP2_EVIDENCE_SHA = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";

export const git = (args: string[]): string =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
export const gitBuf = (args: string[]): Buffer =>
  execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
export const showAt = (sha: string, rel: string): Buffer => gitBuf(["show", `${sha}:${rel}`]);
export const showJson = <T>(sha: string, rel: string): T => JSON.parse(showAt(sha, rel).toString("utf8")) as T;
export const sha256 = (b: Buffer | string): string => "sha256:" + createHash("sha256").update(b).digest("hex");

export const FROZEN = {
  intentHash: "sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e",
  milestoneHash: "sha256:89c2fc53393781b20403fe13d5cf4847fde85b1636935c09339a4487e13d898c",
  functionalHash: "sha256:7ddb250fe9e29d2d471854f09ca2ea27b466948d94e23e35b49f1e256dce4ffd",
  policyHash: "sha256:21d8eb84c1840ee8d03330d7f03f19070c1e812e9fde41d3da0c0f0d4b3e6ba3",
  receiptHash: "sha256:da577b3d04bc53dac6ace4c200679ab36bc1fa21e8be31e2e5c7197cc7706380",
  holdHash: "sha256:78f775b8d711b734648baa08dd91553ad41f69f96296df9bb879f1da665b64fe",
  verifierLockSha: "sha256:fcf3cec903ee82f4a96bf2e75ca586e85bb9e18c21ee4d0a31903c31e2e02337",
  baseLockSha: "sha256:2710c8d4935da522c0ab1a09d1769e7cda1b334f0fdf5ea1c3b212018b61bbbf",
  vitest: "3.2.7",
  typescript: "5.9.3",
  functionalKeyId: "gp3-gp3-functional-ed25519-v2",
  policyKeyId: "gp3-gp3-policy-ed25519-v2",
} as const;

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const SEP = Uint8Array.from([0]);
function sha256b(...chunks: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}
const hash32 = (h: string) => Uint8Array.from(Buffer.from(h.slice(7), "hex"));
const uuid16 = (u: string) => Uint8Array.from(Buffer.from(u.replace(/-/g, ""), "hex"));
const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return new Uint8Array(b); };

export function proofBinding(p: { intent_hash: string; milestone_id: string; milestone_revision: number; bundle_id: string; evidence_root: string; policy_hash: string }): string {
  return `sha256:${Buffer.from(sha256b(
    utf8("intent-protocol/v1/proof-binding"), SEP,
    hash32(p.intent_hash), uuid16(p.milestone_id), u32be(p.milestone_revision),
    uuid16(p.bundle_id), hash32(p.evidence_root), hash32(p.policy_hash),
  )).toString("hex")}`;
}

export function verifyEd25519(publicKeyPem: string, contentHash: string, signatureB64: string): boolean {
  try {
    return edVerify(null, Buffer.from(contentHash, "utf8"), publicKeyPem, Buffer.from(signatureB64, "base64"));
  } catch { return false; }
}

/**
 * INDEPENDENT receipt engine — minimal reimplementation for formal negative replay.
 * Verifies signature (full contract), then checks policy/binding/roles/proof_binding.
 */
export type Rejection =
  | "not-two-decisions" | "verifier-roles-not-exact" | "seal-rejected"
  | "content-hash-mismatch" | "signature-invalid" | "policy-not-satisfied"
  | "binding-mismatch" | "binding-inputs-inconsistent" | "wrong-proof-binding";

const REQUIRED_ROLES = new Set(["verifier:gp3-functional", "verifier:gp3-policy"]);
const BINDING_KEYS = ["intent_hash", "milestone_id", "milestone_revision", "bundle_id", "evidence_root", "policy_hash"] as const;

// We import the schema lazily to avoid circular dependency in the formal test
let schemas: any = null;
export function getSchemas(): any {
  if (!schemas) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    schemas = require(path.join(repoRoot, "node_modules/@intent/protocol-schema/dist/index.js"));
  }
  return schemas;
}

export function independentFormReceipt(
  rawDecisions: Array<Record<string, any>>,
  ctx: { binding: Record<string, unknown> },
  registry: { keys: Array<{ verifier_id: string; key_id: string; public_key_pem: string; algorithm: string }> },
): { ok: boolean; reason?: Rejection } {
  if (rawDecisions.length !== 2) return { ok: false, reason: "not-two-decisions" };

  const { VerificationDecisionSchema, seal } = getSchemas();
  const sealed: Array<{ d: Record<string, any>; ch: string }> = [];
  for (const raw of rawDecisions) {
    const declaredHash = raw.content_hash !== undefined ? String(raw.content_hash) : undefined;
    const { content_hash: _s, ...body } = raw; void _s;
    let resealed: Record<string, any>;
    try { resealed = seal(VerificationDecisionSchema, body); }
    catch { return { ok: false, reason: "seal-rejected" }; }
    if (declaredHash !== undefined && declaredHash !== String(resealed.content_hash)) return { ok: false, reason: "content-hash-mismatch" };
    const sig = raw.signature;
    if (!sig?.scheme || !sig?.signer || !sig?.key_id || !sig?.value) return { ok: false, reason: "signature-invalid" };
    const verifierId = String(resealed.verifier_id);
    if (sig.scheme !== "ed25519" || sig.signer !== verifierId) return { ok: false, reason: "signature-invalid" };
    const entry = registry.keys.find((k) => k.verifier_id === verifierId);
    if (!entry || entry.algorithm !== "ed25519" || sig.key_id !== entry.key_id) return { ok: false, reason: "signature-invalid" };
    if (!verifyEd25519(entry.public_key_pem, String(resealed.content_hash), sig.value)) return { ok: false, reason: "signature-invalid" };
    sealed.push({ d: resealed, ch: String(resealed.content_hash) });
  }

  const roles = new Set(sealed.map((s) => String(s.d.verifier_id)));
  if (roles.size !== 2 || ![...roles].every((r) => REQUIRED_ROLES.has(r))) return { ok: false, reason: "verifier-roles-not-exact" };

  const sa = sealed[0]!; const sb = sealed[1]!;
  const da = sa.d, cha = sa.ch, db = sb.d, chb = sb.ch;
  if (cha === chb) return { ok: false, reason: "content-hash-mismatch" };
  if (da.result !== "VALID" || db.result !== "VALID") return { ok: false, reason: "policy-not-satisfied" };
  for (const k of BINDING_KEYS) {
    if (da[k] !== db[k]) return { ok: false, reason: "binding-inputs-inconsistent" };
    if (String(da[k]) !== String(ctx.binding[k])) return { ok: false, reason: "binding-mismatch" };
  }
  const expected = proofBinding({ intent_hash: String(da.intent_hash), milestone_id: String(da.milestone_id), milestone_revision: Number(da.milestone_revision), bundle_id: String(da.bundle_id), evidence_root: String(da.evidence_root), policy_hash: String(da.policy_hash) });
  if (da.proof_binding !== expected || db.proof_binding !== expected) return { ok: false, reason: "wrong-proof-binding" };
  return { ok: true };
}
