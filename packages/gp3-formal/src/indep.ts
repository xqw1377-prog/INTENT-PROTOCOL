/**
 * GP3 formal verifier independent primitives.
 * ZERO imports from gp3-verification. Reads the SUT target as EVIDENCE from
 * the git object database, independently recomputes everything.
 */
import { execFileSync } from "node:child_process";
import { createHash, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const FORMAL_TARGET = "f6926835fe095db66cd74d78873ab9e25b37c361";
export const BASE_SHA = "5a72525413431dc04f039df9cf01842083bb8db0";
export const GP2_EVIDENCE_SHA = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
export const GP2_RUN_ID = "9f6610dc-24e9-4e6c-b7c1-67574064d2ae";

export const git = (args: string[]): string =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
export const gitBuf = (args: string[]): Buffer =>
  execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
export const showAt = (sha: string, rel: string): Buffer => gitBuf(["show", `${sha}:${rel}`]);
export const showJson = <T>(sha: string, rel: string): T => JSON.parse(showAt(sha, rel).toString("utf8")) as T;
export const sha256 = (b: Buffer | string): string => "sha256:" + createHash("sha256").update(b).digest("hex");

// Frozen values (Commander-frozen in Issue #32 final freeze comment)
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
} as const;

// R9 proof binding (frozen byte protocol, independent implementation)
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

export function deriveUuid(seed: string): string {
  const b = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const h = b.slice(0, 12) + "4" + b.slice(13, 16) + "8" + b.slice(17, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
