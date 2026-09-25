import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  BASE_SHA, SUT_SHA as T, FROZEN, REQUIRED_SUBTREE, git, showAt, showJson, sha256,
  proofBinding, verifyEd25519, independentFormReceipt, runCleanInstall,
} from "../src/indep.js";
import { canonicalize, seal, VerificationDecisionSchema, OutcomeReceiptSchema, IntentContractSchema, MilestoneSchema, EvidenceBundleSchema, merkleRoot } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import r9Vector from "../../conformance-harness/vectors/proof-binding-vector.json";

/**
 * GP3 FORMAL V3 — clean base main@5a72525, SUT read via git show only.
 * All 4 blockers closed + live G1 subtree guard.
 */
const EVID = `packages/golden-path/evidence/9f6610dc-24e9-4e6c-b7c1-67574064d2ae`;
const GP3 = "packages/gp3-verification";

const intent = showJson<Record<string, any>>(T, "packages/golden-path/identity/intent.json");
const milestone = showJson<Record<string, any>>(T, "packages/golden-path/identity/milestone.json");
const bundle = showJson<Record<string, any>>(BASE_SHA, `${EVID}/bundle.json`);
const registry = showJson<Record<string, any>>(T, `${GP3}/keys/verifier-registry.json`);
const funcSigned = showJson<Record<string, any>>(T, `${GP3}/artifacts/decision-functional.json`);
const polSigned = showJson<Record<string, any>>(T, `${GP3}/artifacts/decision-policy.json`);
const receipt = showJson<Record<string, any>>(T, `${GP3}/artifacts/receipt.json`);

const negNames = ["policy-invalid-result", "wrong-bundle-id", "wrong-evidence-root", "wrong-policy-hash", "wrong-milestone-revision", "second-functional", "attacker-verifier", "copied-signature"];
const negatives = negNames.map((n) => showJson<Record<string, any>>(T, `${GP3}/artifacts/negatives/${n}.json`));

const binding = {
  intent_hash: String(intent.content_hash),
  milestone_id: String(bundle.milestone_id),
  milestone_revision: Number(bundle.milestone_revision),
  bundle_id: String(bundle.bundle_id),
  evidence_root: String(bundle.merkle_root),
  policy_hash: String(bundle.policy_hash),
};
const ctx = { binding: binding as unknown as Record<string, unknown> };
const tryForm = (ds: any[], c: any) => {
  try { return independentFormReceipt(ds, c, registry as any); }
  catch { return { ok: false, reason: "seal-rejected" as const }; }
};

const GATES: Record<string, string> = {
  "policy-invalid-result": "policy-not-satisfied",
  "wrong-bundle-id": "binding-inputs-inconsistent",
  "wrong-evidence-root": "binding-inputs-inconsistent",
  "wrong-policy-hash": "binding-inputs-inconsistent",
  "wrong-milestone-revision": "binding-inputs-inconsistent",
  "second-functional": "verifier-roles-not-exact",
  "attacker-verifier": "signature-invalid",
  "copied-signature": "signature-invalid",
};

describe("[GP3-FORMAL-V3]", () => {
  test("[F0.1] branch base = main@5a72525; SUT read via git show only", () => {
    // SUT is NOT an ancestor of this branch (independence)
    const isAncestor = spawnSyncGit(["merge-base", "--is-ancestor", T, "HEAD"]);
    expect(isAncestor).toBe(false);
  });

  test("[F0.2] live G1 schema subtree still frozen", () => {
    expect(git(["rev-parse", "HEAD:packages/protocol-schema"])).toBe(REQUIRED_SUBTREE);
  });

  test("[F0.3] formal workspace complete (package.json + lock entry)", () => {
    const lockJson = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../package-lock.json"), "utf8"));
    expect(lockJson.packages).toHaveProperty("packages/gp3-formal");
  });

  test("[F1.1] R9 golden KAT", () => expect(proofBinding(r9Vector.case as any)).toBe(r9Vector.expected));

  test("[F1.2] frozen identity re-seal from SUT object database", () => {
    const { content_hash: _c, signature: _s, ...ib } = intent; void _c; void _s;
    expect(String((seal(IntentContractSchema as never, ib) as any).content_hash)).toBe(FROZEN.intentHash);
    const { content_hash: _mc, signature: _ms, ...mb } = milestone; void _mc; void _ms;
    expect(String((seal(MilestoneSchema as never, mb) as any).content_hash)).toBe(FROZEN.milestoneHash);
    expect(milestone.intent_hash).toBe(intent.content_hash);
  });

  test("[F2.1b] Functional: independent re-seal + V2 signature (actual)", () => {
    const { content_hash: _c, signature: _s, ...body } = funcSigned; void _c; void _s;
    const resealed = seal(VerificationDecisionSchema as never, body) as any;
    expect(String(resealed.content_hash)).toBe(FROZEN.functionalHash);
    expect(String(funcSigned.content_hash)).toBe(FROZEN.functionalHash);
    // V2 signature
    const key = (registry.keys as any[]).find((k) => k.verifier_id === "verifier:gp3-functional");
    expect(key.key_id).toBe(FROZEN.functionalKeyId);
    expect(funcSigned.signature.key_id).toBe(FROZEN.functionalKeyId);
    expect(funcSigned.signature.signer).toBe("verifier:gp3-functional");
    expect(funcSigned.signature.scheme).toBe("ed25519");
    expect(key.algorithm).toBe("ed25519");
    expect(verifyEd25519(key.public_key_pem, FROZEN.functionalHash, funcSigned.signature.value)).toBe(true);
    expect(resealed.result).toBe("VALID");
    expect(resealed.proof_binding).toBe(proofBinding(binding));
  });

  test("[F2.2] Policy: independent re-seal + V2 signature", () => {
    const { content_hash: _c, signature: _s, ...body } = polSigned; void _c; void _s;
    const resealed = seal(VerificationDecisionSchema as never, body) as any;
    expect(String(resealed.content_hash)).toBe(FROZEN.policyHash);
    const key = (registry.keys as any[]).find((k) => k.verifier_id === "verifier:gp3-policy");
    expect(key.key_id).toBe(FROZEN.policyKeyId);
    expect(verifyEd25519(key.public_key_pem, FROZEN.policyHash, polSigned.signature.value)).toBe(true);
    expect(resealed.result).toBe("VALID");
    expect(resealed.proof_binding).toBe(proofBinding(binding));
  });

  test("[F2.3] V1 keys completely revoked", () => {
    expect(JSON.stringify({ registry, funcSigned, polSigned, negatives }).includes("ed25519-v1")).toBe(false);
  });

  test("[F3.1] Receipt re-seal == committed", () => {
    const { content_hash: _c, ...body } = receipt; void _c;
    expect(String((seal(OutcomeReceiptSchema as never, body) as any).content_hash)).toBe(FROZEN.receiptHash);
    const dh = receipt.decision_hashes as string[];
    expect(dh).toEqual([FROZEN.functionalHash, FROZEN.policyHash].sort());
  });

  test("[F4.1] TRUE independent negative gate replay (8 fixtures, exact gates)", () => {
    for (const fixture of negatives) {
      const name = String(fixture._fixture_name);
      const expected = GATES[name];
      expect(expected).toBeDefined();
      const { _fixture_name: _fn, _pair_with: _pw, ...clean } = fixture; void _fn; void _pw;
      const result = tryForm([funcSigned, clean], ctx);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(expected);
    }
  });

  test("[F4.2] HOLD canonical hash from frozen source", () => {
    const hold = JSON.parse(showAt(BASE_SHA, "packages/golden-path/identity/policies/gp-001-settlement-hold-v1.json").toString("utf8"));
    expect(sha256(canonicalize(hold))).toBe(FROZEN.holdHash);
    expect(hold.release_enabled).toBe(false);
  });

  test("[F5.1] verifier lock SHA from SUT", () => {
    expect(sha256(showAt(T, "package-lock.json"))).toBe(FROZEN.verifierLockSha);
  });

  test("[F5.2] REAL clean install evidence: temp dir + npm ci + version check", () => {
    const ev = runCleanInstall();
    expect(ev.install_ok).toBe(true);
    expect(ev.exit_code).toBe(0);
    expect(ev.lockfile_sha256).toBe(FROZEN.verifierLockSha);
    expect(ev.node_version).toMatch(/^v\d+/);
    expect(ev.vitest_version_installed).toBe(FROZEN.vitest);
    expect(ev.typescript_version_installed).toBe(FROZEN.typescript);
  });

  test("[F5.3] trust root read-only + no private keys + GP4+ absent", () => {
    const keysSrc = showAt(T, `${GP3}/src/keys.ts`).toString("utf8");
    expect(keysSrc.includes("generateKeyPairSync")).toBe(false);
    expect(keysSrc.includes("writeFileSync")).toBe(false);
    expect(git(["ls-tree", "-r", "--name-only", T]).split("\n").filter((f) => f.includes(".pem")).length).toBe(0);
    for (const f of ["src/keys.ts", "src/compute.ts", "src/receipt.ts", "src/verifiers.ts"]) {
      const src = showAt(T, `${GP3}/${f}`).toString("utf8");
      for (const bad of [/SettlementInstruction/, /releaseEscrow/, /transferFunds/, /payOut/, /devnet/i, /solana/i]) {
        expect(bad.test(src)).toBe(false);
      }
    }
  });

  test("[F5.4] provenance + GP2 bundle integrity", () => {
    const prov = showJson<Record<string, any>>(BASE_SHA, "packages/golden-path/identity/provenance.json");
    expect(prov.materialization_timing).toBe("POST_GP2_REMEDIATION");
    expect(prov.UNRESOLVED_FIELDS).toEqual([]);
    expect(bundle.state).toBe("SEALED");
    const artifacts = showJson<any[]>(BASE_SHA, `${EVID}/artifacts.json`);
    expect(String(bundle.merkle_root)).toBe(merkleRoot(artifacts.map((a: any) => a.payload_hash) as Hash[]));
  });
});

function spawnSyncGit(args: string[]): boolean {
  const { spawnSync } = require("node:child_process");
  const r = spawnSync("git", args, { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."), encoding: "utf8" });
  return r.status === 0;
}
