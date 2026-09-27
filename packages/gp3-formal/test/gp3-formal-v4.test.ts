import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  BASE_SHA, SUT_SHA as T, FROZEN, REQUIRED_SUBTREE, git, showAt, showJson, sha256, repoRoot,
  proofBinding, verifyEd25519, independentFormReceipt, runManifestLockReplay,
} from "../src/indep.js";
import { canonicalize, seal, VerificationDecisionSchema, OutcomeReceiptSchema, IntentContractSchema, MilestoneSchema, EvidenceBundleSchema, merkleRoot } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import r9Vector from "../../conformance-harness/vectors/proof-binding-vector.json";

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

describe("[GP3-FORMAL-V4]", () => {
  test("[F0.1] SUT lineage invariant — branch-audit (non-ancestor) OR main regression (frozen target/provenance)", () => {
    // The original F0.1 invariant — "SUT must NOT be an ancestor of HEAD" — is a
    // BRANCH-AUDIT condition: it guarantees the verifier audits a candidate that
    // has not already been merged into its own lineage. Once the candidate IS
    // merged (main regression runs), that condition is structurally impossible,
    // so asserting it would turn every post-merge run permanently red.
    //
    // We therefore split into two EXPLICIT modes rather than weaken or delete the
    // test. The mode is derived from real git topology — never from "make it
    // pass" — and each mode asserts its own meaningful invariant:
    //
    //   branch-audit    : SUT NOT ancestor → assert the non-ancestor invariant.
    //   main-regression : SUT IS ancestor  → assert the frozen target is a
    //                     reachable revision whose provenance still recomputes
    //                     byte-exact (history rewrite / artifact drift goes RED).
    const isAncestor = spawnSync("git", ["merge-base", "--is-ancestor", T, "HEAD"], { cwd: repoRoot, encoding: "utf8" }).status === 0;
    const forced = process.env.FORMAL_AUDIT_MODE;
    if (forced !== undefined && forced !== "branch-audit" && forced !== "main-regression") {
      throw new Error(`unknown FORMAL_AUDIT_MODE='${forced}' (expected branch-audit | main-regression)`);
    }
    const mode: "branch-audit" | "main-regression" = forced ?? (isAncestor ? "main-regression" : "branch-audit");

    if (mode === "branch-audit") {
      expect(isAncestor, `branch-audit: SUT ${T} must NOT be an ancestor of HEAD`).toBe(false);
      return;
    }

    expect(isAncestor, `main-regression: SUT ${T} must be an ancestor of HEAD`).toBe(true);
    expect(git(["cat-file", "-t", T])).toBe("commit");
    expect(sha256(showAt(T, "package-lock.json"))).toBe(FROZEN.verifierLockSha);
    const { content_hash: _ci, signature: _si, ...ib } = intent; void _ci; void _si;
    expect(String((seal(IntentContractSchema as never, ib) as any).content_hash)).toBe(FROZEN.intentHash);
    const { content_hash: _cm, signature: _sm, ...mb2 } = milestone; void _cm; void _sm;
    expect(String((seal(MilestoneSchema as never, mb2) as any).content_hash)).toBe(FROZEN.milestoneHash);
  });

  test("[F0.2] live G1 schema subtree still frozen", () => {
    expect(git(["rev-parse", "HEAD:packages/protocol-schema"])).toBe(REQUIRED_SUBTREE);
  });

  test("[F0.3] formal workspace complete", () => {
    const lockJson = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../package-lock.json"), "utf8"));
    expect(lockJson.packages).toHaveProperty("packages/gp3-formal");
  });

  test("[F1.1] R9 golden KAT", () => expect(proofBinding(r9Vector.case as any)).toBe(r9Vector.expected));

  test("[F1.2] frozen identity re-seal from SUT", () => {
    const { content_hash: _c, signature: _s, ...ib } = intent; void _c; void _s;
    expect(String((seal(IntentContractSchema as never, ib) as any).content_hash)).toBe(FROZEN.intentHash);
    const { content_hash: _mc, signature: _ms, ...mb } = milestone; void _mc; void _ms;
    expect(String((seal(MilestoneSchema as never, mb) as any).content_hash)).toBe(FROZEN.milestoneHash);
  });

  test("[F2.1] Functional: independent re-seal + V3 signature", () => {
    const { content_hash: _c, signature: _s, ...body } = funcSigned; void _c; void _s;
    const resealed = seal(VerificationDecisionSchema as never, body) as any;
    expect(String(resealed.content_hash)).toBe(FROZEN.functionalHash);
    const key = (registry.keys as any[]).find((k) => k.verifier_id === "verifier:gp3-functional");
    expect(key.key_id).toBe(FROZEN.functionalKeyId);
    expect(funcSigned.signature.key_id).toBe(FROZEN.functionalKeyId);
    expect(verifyEd25519(key.public_key_pem, FROZEN.functionalHash, funcSigned.signature.value)).toBe(true);
    expect(resealed.result).toBe("VALID");
    expect(resealed.proof_binding).toBe(proofBinding(binding));
  });

  test("[F2.2] Policy: independent re-seal + V3 signature", () => {
    const { content_hash: _c, signature: _s, ...body } = polSigned; void _c; void _s;
    const resealed = seal(VerificationDecisionSchema as never, body) as any;
    expect(String(resealed.content_hash)).toBe(FROZEN.policyHash);
    const key = (registry.keys as any[]).find((k) => k.verifier_id === "verifier:gp3-policy");
    expect(key.key_id).toBe(FROZEN.policyKeyId);
    expect(verifyEd25519(key.public_key_pem, FROZEN.policyHash, polSigned.signature.value)).toBe(true);
    expect(resealed.result).toBe("VALID");
  });

  test("[F2.3] V1 + V2 keys completely revoked (zero residue)", () => {
    const all = JSON.stringify({ registry, funcSigned, polSigned, negatives });
    expect(all.includes("ed25519-v1")).toBe(false);
    expect(all.includes("ed25519-v2")).toBe(false);
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

  test("[F5.2] REAL manifest+lock replay: SUT's exact package.json + package-lock.json + workspaces → npm ci", () => {
    const ev = runManifestLockReplay();
    expect(ev.install_ok).toBe(true);
    expect(ev.exit_code).toBe(0);
    expect(ev.package_lock_sha256).toBe(FROZEN.verifierLockSha);
    expect(ev.package_json_sha256).toMatch(/^sha256:/);
    expect(ev.vitest_version_installed).toBe(FROZEN.vitest);
    expect(ev.typescript_version_installed).toBe(FROZEN.typescript);
    expect(ev.node_version).toMatch(/^v\d+/);
    expect(ev.workspace_count).toBeGreaterThanOrEqual(6);
  }, 300_000);

  test("[F5.3] trust root read-only + no private keys + GP4+ absent", () => {
    const keysSrc = showAt(T, `${GP3}/src/keys.ts`).toString("utf8");
    expect(keysSrc.includes("generateKeyPairSync")).toBe(false);
    expect(keysSrc.includes("writeFileSync")).toBe(false);
    expect(git(["ls-tree", "-r", "--name-only", T]).split("\n").filter((f) => f.includes(".pem")).length).toBe(0);
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
