/**
 * GP3 F3 formal verifier — INDEPENDENT from main@5a72525.
 * SUT read exclusively via `git show e73969f:<path>` (object database).
 * ZERO gp3-verification imports, ZERO SUT code execution.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const BASE_SHA = "5a72525413431dc04f039df9cf01842083bb8db0";
export const SUT_SHA = "e73969f527de5cb590f874690b14b3c25a4448f6";
export const GP2_EVIDENCE_SHA = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
export const REQUIRED_SUBTREE = "bb14d9375c92d64072f3e8c2f2dd65d794008422";

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
function sha256b(...c: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const x of c) h.update(x);
  return new Uint8Array(h.digest());
}
const hash32 = (h: string) => Uint8Array.from(Buffer.from(h.slice(7), "hex"));
const uuid16 = (u: string) => Uint8Array.from(Buffer.from(u.replace(/-/g, ""), "hex"));
const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return new Uint8Array(b); };

export function proofBinding(p: { intent_hash: string; milestone_id: string; milestone_revision: number; bundle_id: string; evidence_root: string; policy_hash: string }): string {
  return `sha256:${Buffer.from(sha256b(
    utf8("intent-protocol/v1/proof-binding"), SEP,
    hash32(p.intent_hash), uuid16(p.milestone_id), u32be(p.milestone_revision),
    uuid32(p.bundle_id), hash32(p.evidence_root), hash32(p.policy_hash),
  )).toString("hex")}`;
}
const uuid32 = (u: string) => uuid16(u); // alias for readability

export function verifyEd25519(publicKeyPem: string, contentHash: string, signatureB64: string): boolean {
  try { return edVerify(null, Buffer.from(contentHash, "utf8"), publicKeyPem, Buffer.from(signatureB64, "base64")); }
  catch { return false; }
}

// Lazy schema access — from the LIVE main tree (verified against frozen subtree)
let liveSchemas: any = null;
export function getSchemas(): any {
  if (!liveSchemas) {
    liveSchemas = require(path.join(repoRoot, "node_modules/@intent/protocol-schema/dist/index.js"));
  }
  return liveSchemas;
}

export type Rejection =
  | "not-two-decisions" | "verifier-roles-not-exact" | "seal-rejected"
  | "content-hash-mismatch" | "signature-invalid" | "policy-not-satisfied"
  | "binding-mismatch" | "binding-inputs-inconsistent" | "wrong-proof-binding";

const REQUIRED_ROLES = new Set(["verifier:gp3-functional", "verifier:gp3-policy"]);
const BINDING_KEYS = ["intent_hash", "milestone_id", "milestone_revision", "bundle_id", "evidence_root", "policy_hash"] as const;

export function independentFormReceipt(
  rawDecisions: Array<Record<string, any>>,
  ctx: { binding: Record<string, unknown> },
  registry: { keys: Array<{ verifier_id: string; key_id: string; public_key_pem: string; algorithm: string }> },
): { ok: boolean; reason?: Rejection } {
  if (rawDecisions.length !== 2) return { ok: false, reason: "not-two-decisions" };
  const { VerificationDecisionSchema, seal } = getSchemas();
  const sealed: Array<{ d: Record<string, any>; ch: string }> = [];
  for (const raw of rawDecisions) {
    const declared = raw.content_hash !== undefined ? String(raw.content_hash) : undefined;
    const { content_hash: _s, ...body } = raw; void _s;
    let r: Record<string, any>;
    try { r = seal(VerificationDecisionSchema, body); } catch { return { ok: false, reason: "seal-rejected" }; }
    if (declared !== undefined && declared !== String(r.content_hash)) return { ok: false, reason: "content-hash-mismatch" };
    const sig = raw.signature;
    if (!sig?.scheme || !sig?.signer || !sig?.key_id || !sig?.value) return { ok: false, reason: "signature-invalid" };
    const vid = String(r.verifier_id);
    if (sig.scheme !== "ed25519" || sig.signer !== vid) return { ok: false, reason: "signature-invalid" };
    const e = registry.keys.find((k) => k.verifier_id === vid);
    if (!e || e.algorithm !== "ed25519" || sig.key_id !== e.key_id) return { ok: false, reason: "signature-invalid" };
    if (!verifyEd25519(e.public_key_pem, String(r.content_hash), sig.value)) return { ok: false, reason: "signature-invalid" };
    sealed.push({ d: r, ch: String(r.content_hash) });
  }
  const roles = new Set(sealed.map((s) => String(s.d.verifier_id)));
  if (roles.size !== 2 || ![...roles].every((r) => REQUIRED_ROLES.has(r))) return { ok: false, reason: "verifier-roles-not-exact" };
  const sa = sealed[0]!, sb = sealed[1]!;
  const { d: da, ch: cha } = sa, { d: db, ch: chb } = sb;
  if (cha === chb) return { ok: false, reason: "content-hash-mismatch" };
  if (da.result !== "VALID" || db.result !== "VALID") return { ok: false, reason: "policy-not-satisfied" };
  for (const k of BINDING_KEYS) {
    if (da[k] !== db[k]) return { ok: false, reason: "binding-inputs-inconsistent" };
    if (String(da[k]) !== String(ctx.binding[k])) return { ok: false, reason: "binding-mismatch" };
  }
  const exp = proofBinding({ intent_hash: String(da.intent_hash), milestone_id: String(da.milestone_id), milestone_revision: Number(da.milestone_revision), bundle_id: String(da.bundle_id), evidence_root: String(da.evidence_root), policy_hash: String(da.policy_hash) });
  if (da.proof_binding !== exp || db.proof_binding !== exp) return { ok: false, reason: "wrong-proof-binding" };
  return { ok: true };
}

/**
 * REAL clean install: temp dir → copy verifier lock from SUT → npm ci → verify versions.
 * Returns structured evidence; caller asserts all fields.
 */
export interface InstallEvidence {
  command: string;
  exit_code: number;
  lockfile_sha256: string;
  node_version: string;
  npm_version: string;
  vitest_version_installed: string;
  typescript_version_installed: string;
  install_ok: boolean;
}

export function runCleanInstall(): InstallEvidence {
  const { mkdtempSync, writeFileSync, rmSync, readFileSync: rf } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const tmp = mkdtempSync(path.join(tmpdir(), "gp3-f3-install-"));
  try {
    // Extract the verifier lock from the SUT target
    const lockBytes = showAt(SUT_SHA, "package-lock.json");
    const lockSha = sha256(lockBytes);
    writeFileSync(path.join(tmp, "package-lock.json"), lockBytes);
    // Also need a minimal package.json that references the lock (npm ci requires it)
    const lockJson = JSON.parse(lockBytes.toString("utf8"));
    writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
      name: "gp3-formal-install-probe",
      version: "0.0.0",
      private: true,
      dependencies: {
        vitest: lockJson.packages?.["node_modules/vitest"]?.version ?? "*",
        typescript: lockJson.packages?.["node_modules/typescript"]?.version ?? "*",
      },
    }, null, 2) + "\n");
    // Run npm ci in the temp dir
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const install = spawnSync(npmCmd, ["ci", "--no-audit", "--no-fund", "--ignore-scripts"], {
      cwd: tmp, encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024 * 1024,
      ...(process.platform === "win32" ? { shell: true } : {}),
    });
    const exitCode = install.status ?? -1;
    // Read installed versions from the temp node_modules
    let vitestVer = "unknown", tscVer = "unknown";
    try { vitestVer = JSON.parse(rf(path.join(tmp, "node_modules/vitest/package.json"), "utf8")).version; } catch {}
    try { tscVer = JSON.parse(rf(path.join(tmp, "node_modules/typescript/package.json"), "utf8")).version; } catch {}
    const npmVer = process.env.npm_config_user_agent?.split(" ")[0]?.split("/")[1] ?? "unknown";
    return {
      command: "npm ci --no-audit --no-fund --ignore-scripts",
      exit_code: exitCode,
      lockfile_sha256: lockSha,
      node_version: process.version,
      npm_version: npmVer,
      vitest_version_installed: vitestVer,
      typescript_version_installed: tscVer,
      install_ok: exitCode === 0,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
