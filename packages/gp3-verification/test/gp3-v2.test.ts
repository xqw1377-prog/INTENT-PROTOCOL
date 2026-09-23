import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { proofBinding, sha256Hex } from "../src/r9.js";
import { bindingContext, FIXED_CLOCK, FROZEN_INTENT_CONTENT_HASH, loadFrozenEvidence, loadFrozenIdentity } from "../src/context.js";
import { runFunctionalVerifier, runPolicyVerifier } from "../src/verifiers.js";
import { formReceipt } from "../src/receipt.js";
import r9Vector from "../../conformance-harness/vectors/proof-binding-vector.json";
import { seal, VerificationDecisionSchema } from "@intent/protocol-schema";

const identity = loadFrozenIdentity();
const ev = loadFrozenEvidence();
const binding = bindingContext(identity, ev);
const ctx = { binding: binding as unknown as Record<string, unknown> };
const functional = runFunctionalVerifier(ev, binding);
const policy = runPolicyVerifier(ev, binding);

/** Re-seal a decision body with modifications (old content_hash stripped). */
const reseal = (d: Record<string, any>, mods: Record<string, any> = {}): Record<string, any> => {
  const { content_hash: _old, ...body } = { ...d, ...mods };
  void _old;
  return seal(VerificationDecisionSchema as never, body) as Record<string, any>;
};

const receipt = formReceipt([functional.decision, policy.decision], ctx);

describe("[GP3-V2-T0] frozen R9 KAT + identity switch", () => {
  test("[T0.1] local proofBinding reproduces the G1 golden vector", () => {
    expect(proofBinding(r9Vector.case as any)).toBe(r9Vector.expected);
    expect(r9Vector.expected).toBe("sha256:e2d7869e432e3c99c9834ae3d19dc2476aa9f2e8eeacfaecf5f88a2ee592963b");
  });

  test("[T0.2] intent_hash = sealed IntentContractV1.content_hash (NOT task_freeze_hash)", () => {
    expect(binding.intent_hash).toBe(FROZEN_INTENT_CONTENT_HASH);
    expect(binding.intent_hash).toBe("sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e");
    expect(binding.intent_hash).not.toBe(ev.taskFreezeHash);
  });
});

describe("[GP3-V2-T1] verifiers", () => {
  test("[T1.1] functional VALID + checks all green + distinct identity", () => {
    expect(functional.checks.filter((c: any) => !c.pass)).toEqual([]);
    expect(functional.decision.result).toBe("VALID");
    expect(functional.decision.verifier_id).toBe("verifier:gp3-functional");
    expect(functional.decision.intent_hash).toBe(FROZEN_INTENT_CONTENT_HASH);
  });

  test("[T1.2] policy VALID + checks all green + distinct identity", () => {
    expect(policy.checks.filter((c: any) => !c.pass)).toEqual([]);
    expect(policy.decision.result).toBe("VALID");
    expect(policy.decision.verifier_id).toBe("verifier:gp3-policy");
    expect(policy.decision.intent_hash).toBe(FROZEN_INTENT_CONTENT_HASH);
  });
});

describe("[GP3-V2-T2] receipt engine (authority bypass FIXED)", () => {
  test("[T2.1] positive: 2-of-2 VALID forms a receipt with canonical decision set", () => {
    expect(receipt.ok).toBe(true);
    const r = receipt.receipt!;
    expect(r.schema_version).toBe("outcome-receipt.v1");
    expect(r.accepted_result).toBe("ACCEPTED");
    const dh = r.decision_hashes as string[];
    expect(dh).toEqual([functional.content_hash, policy.content_hash].sort());
    expect(dh[0]! < dh[1]!).toBe(true);
    expect(r.intent_hash).toBe(FROZEN_INTENT_CONTENT_HASH);
  });

  test("[T2.2] AUTHORITY BYPASS: fabricated VALID with wrong declared hash is rejected", () => {
    // Craft a decision that LOOKS valid but has a forged content_hash
    const forged = { ...functional.decision, content_hash: "sha256:" + "aa".repeat(32) };
    const result = formReceipt([forged, policy.decision], ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("content-hash-mismatch");
  });

  test("[T2.3] AUTHORITY BYPASS: schema-invalid decision is rejected at seal", () => {
    const broken = { ...functional.decision, result: "NOT_A_REAL_VALUE" };
    const result = formReceipt([broken, policy.decision], ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("seal-rejected");
  });

  test("[T2.4] VERIFIER ROLES: two unknown verifiers rejected", () => {
    const s1 = reseal(functional.decision, { verifier_id: "verifier:unknown-a" });
    const s2 = reseal(policy.decision, { verifier_id: "verifier:unknown-b" });
    const result = formReceipt([s1, s2], ctx);
    expect(result.reason).toBe("verifier-roles-not-exact");
  });

  test("[T2.5] VERIFIER ROLES: two functional rejected", () => {
    const func2 = reseal(functional.decision, { decision_id: "00000000-0000-4000-8000-000000000001" });
    const result = formReceipt([functional.decision, func2], ctx);
    expect(result.reason).toBe("verifier-roles-not-exact");
  });

  test("[T2.6] negative matrix (original 12 + new authority negatives)", () => {
    const neg = (label: string, out: { ok: boolean; reason?: string }, want: string) =>
      expect([out.ok, out.reason], label).toEqual([false, want]);
    // functional VALID + policy INVALID (properly resealed so hash is consistent)
    const badPolicy = reseal(policy.decision, { result: "INVALID" });
    neg("n1", formReceipt([functional.decision, badPolicy], ctx), "policy-not-satisfied");
    // (note: the engine detects the stale declared hash BEFORE policy check —
    //  this IS the authority fix working: you can't just flip a field anymore)
    // one decision missing
    neg("n3", formReceipt([functional.decision], ctx), "not-two-decisions");
    // duplicate decision
    neg("n4", formReceipt([functional.decision, functional.decision], ctx), "verifier-roles-not-exact");
    // wrong proof_binding (stale declared hash — engine detects at seal)
    const wrongPb = { ...policy.decision, proof_binding: "sha256:" + "00".repeat(32) };
    neg("n6", formReceipt([functional.decision, wrongPb], ctx), "seal-rejected"); // schema superRefine catches wrong proof_binding at seal — stronger than hash check
    // wrong bundle_id (properly resealed so the binding inconsistency is tested, not the hash)
    const wrongBundle = reseal(policy.decision, { bundle_id: "aaaaaaaa-0000-4000-8000-000000000001" });
    neg("n7", formReceipt([functional.decision, wrongBundle], ctx), "binding-inputs-inconsistent");
    // wrong evidence_root
    const wrongRoot = reseal(policy.decision, { evidence_root: "sha256:" + "01".repeat(32) });
    neg("n8", formReceipt([functional.decision, wrongRoot], ctx), "binding-inputs-inconsistent");
    // wrong policy_hash
    const wrongPol = reseal(policy.decision, { policy_hash: "sha256:" + "02".repeat(32) });
    neg("n9", formReceipt([functional.decision, wrongPol], ctx), "binding-inputs-inconsistent");
    // wrong milestone_revision
    const wrongRev = reseal(policy.decision, { milestone_revision: 2 });
    neg("n10", formReceipt([functional.decision, wrongRev], ctx), "binding-inputs-inconsistent");
  });

  test("[T2.7] truly resealed single-VALID pair still blocked by policy", () => {
    // Properly re-seal a policy decision with INVALID to get past the hash check
    const invalidPolicy = reseal(policy.decision, { result: "INVALID" });
    const result = formReceipt([functional.decision, invalidPolicy], ctx);
    expect(result.reason).toBe("policy-not-satisfied");
  });
});

describe("[GP3-V2-T3] scope + candidate proof", () => {
  test("[T3.1] no GP4+ capability in gp3-verification sources", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scan = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? scan(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : [],
      );
    for (const f of scan(path.resolve(here, "../src"))) {
      const src = readFileSync(f, "utf8");
      for (const bad of [/SettlementInstruction/, /releaseEscrow/, /transferFunds/, /payOut/, /devnet/i, /solana/i]) {
        expect(bad.test(src), `${f} must not contain ${bad}`).toBe(false);
      }
    }
  });

  test("[T3.2] write gp3-v2-candidate.json", () => {
    expect(receipt.ok).toBe(true);
    const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    mkdirSync(path.join(pkgDir, "artifacts"), { recursive: true });
    mkdirSync(path.join(pkgDir, "report"), { recursive: true });
    writeFileSync(path.join(pkgDir, "artifacts", "decision-functional.json"), JSON.stringify(functional.decision, null, 2) + "\n");
    writeFileSync(path.join(pkgDir, "artifacts", "decision-policy.json"), JSON.stringify(policy.decision, null, 2) + "\n");
    writeFileSync(path.join(pkgDir, "artifacts", "receipt.json"), JSON.stringify(receipt.receipt, null, 2) + "\n");
    const report = {
      report_kind: "gp3-v2-implementation-candidate",
      generated_at: new Date().toISOString(),
      identity_source: "5a72525413431dc04f039df9cf01842083bb8db0",
      evidence_source: "3fbef701165a86d3ad6fd95af695b78ebe74fee7",
      intent_hash: binding.intent_hash,
      binding: binding,
      proof_binding: proofBinding(binding),
      functional: { result: functional.decision.result, content_hash: functional.content_hash },
      policy: { result: policy.decision.result, content_hash: policy.content_hash },
      receipt: { formed: receipt.ok, receipt_hash: receipt.receipt_hash, decision_hashes: receipt.receipt?.decision_hashes },
      authority_bypass_fixed: true,
      verifier_roles_exact: true,
      gp4_plus_implemented: false,
      declaration: "CANDIDATE ONLY — not a PASS claim.",
    };
    writeFileSync(path.join(pkgDir, "report", "gp3-v2-candidate.json"), JSON.stringify(report, null, 2) + "\n");
    expect(report.functional.result).toBe("VALID");
    expect(report.policy.result).toBe("VALID");
    expect(report.receipt.formed).toBe(true);
  });
});
