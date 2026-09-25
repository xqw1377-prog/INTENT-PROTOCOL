import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { sign as edSign } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, beforeAll } from "vitest";
import { proofBinding, loadFrozenIdentity, loadFrozenEvidence, bindingContext, repoRoot } from "../src/compute.js";
import { computeFunctional, computePolicy } from "../src/verifiers.js";
import { formReceipt } from "../src/receipt.js";
import { verifyDecisionSignature, loadRegistry } from "../src/keys.js";
import r9Vector from "../../conformance-harness/vectors/proof-binding-vector.json";
import { seal, VerificationDecisionSchema } from "@intent/protocol-schema";

/**
 * GP3 V6 FORMAL TEST — F2: unconditional hash equality; F3: exact gate map.
 * F1: install from verified lockfile (not frozen-base broken lockfile).
 * F4: install evidence recorded.
 */
const identity = loadFrozenIdentity();
const ev = loadFrozenEvidence();
const binding = bindingContext(identity, ev);
const ctx = { binding: binding as unknown as Record<string, unknown> };

let functional: ReturnType<typeof computeFunctional>;
let policy: ReturnType<typeof computePolicy>;
beforeAll(() => {
  functional = computeFunctional(ev, binding);
  policy = computePolicy(ev, binding, identity);
}, 300_000);

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(pkgDir, "artifacts");
const negativesDir = path.join(artifactsDir, "negatives");
const readJson = (base: string, name: string): Record<string, any> =>
  JSON.parse(readFileSync(path.join(base, name), "utf8"));

const committedFunctional = readJson(artifactsDir, "decision-functional.json");
const committedPolicy = readJson(artifactsDir, "decision-policy.json");
const committedReceipt = readJson(artifactsDir, "receipt.json");
let committedNegatives: Array<Record<string, any>> = [];
try {
  committedNegatives = readdirSync(negativesDir).filter((f) => f.endsWith(".json")).map((f) => readJson(negativesDir, f));
} catch { /* emit-mode first run */ }

const tryForm = (ds: any[], c: any) => { try { return formReceipt(ds, c); } catch { return { ok: false, reason: "seal-rejected" as const }; } };
const neg = (l: string, out: { ok: boolean; reason?: string }, want: string) => expect([out.ok, out.reason], l).toEqual([false, want]);

// F3: EXACT gate map — each negative fixture MUST produce this specific rejection
const EXPECTED_GATES: Record<string, string> = {
  "policy-invalid-result": "policy-not-satisfied",
  "wrong-bundle-id": "binding-inputs-inconsistent",
  "wrong-evidence-root": "binding-inputs-inconsistent",
  "wrong-policy-hash": "binding-inputs-inconsistent",
  "wrong-milestone-revision": "binding-inputs-inconsistent",
  "second-functional": "verifier-roles-not-exact",
  "attacker-verifier": "seal-rejected", // no registered key for unknown verifier
  "copied-signature": "seal-rejected", // signature is for a different hash
};

function buildSignedNegative(base: Record<string, any>, mods: Record<string, any>, role: string): Record<string, any> {
  const { content_hash: _, signature: _s, ...body } = { ...base, ...mods }; void _; void _s;
  const bindingKeys = ["intent_hash", "milestone_id", "milestone_revision", "bundle_id", "evidence_root", "policy_hash"];
  if (bindingKeys.some((k) => k in mods)) {
    const nb: any = {};
    for (const k of bindingKeys) nb[k] = body[k];
    body.proof_binding = proofBinding(nb);
  }
  const sealed = seal(VerificationDecisionSchema as never, body) as Record<string, any>;
  const ch = String(sealed.content_hash);
  const reg = loadRegistry();
  const entry = reg.keys.find((k: any) => k.verifier_id === role);
  if (!entry) throw new Error(`no key for ${role}`);
  try {
    const privPem = readFileSync(path.join(pkgDir, "keys", "private", `${entry.key_id}.pem`), "utf8");
    const sig = edSign(null, Buffer.from(ch, "utf8"), privPem).toString("base64");
    return { ...sealed, signature: { scheme: "ed25519", signer: role, key_id: entry.key_id, value: sig } };
  } catch {
    return { ...sealed, _unsigned: true };
  }
}

describe("[GP3-V6]", () => {
  test("[T0.1] R9 golden KAT", () => { expect(proofBinding(r9Vector.case as any)).toBe(r9Vector.expected); });
  test("[T0.2] intent_hash = sealed identity", () => { expect(binding.intent_hash).toBe("sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e"); });

  test("[T1.1] B2 functional: VALID + all checks green (from verified lockfile)", () => {
    expect(functional.decision.result).toBe("VALID");
    const failed = (functional.decision.reason_codes as string[]).filter((r: string) => r.startsWith("FAILED_"));
    expect(failed).toEqual([]);
  });

  test("[T1.2] B3 policy: all 26 hard gates green, VALID", () => {
    expect(policy.decision.result).toBe("VALID");
    const failed = (policy.decision.reason_codes as string[]).filter((r: string) => r.startsWith("FAILED_"));
    expect(failed).toEqual([]);
  });

  // F2: UNCONDITIONAL hash equality
  test("[T2.1] F2: recomputed Functional hash == committed (UNCONDITIONAL)", () => {
    expect(functional.content_hash, "recomputed functional hash must equal committed").toBe(String(committedFunctional.content_hash));
  });

  test("[T2.2] F2: recomputed Policy hash == committed (UNCONDITIONAL)", () => {
    expect(policy.content_hash, "recomputed policy hash must equal committed").toBe(String(committedPolicy.content_hash));
  });

  test("[T2.3] F2: receipt recomputation == committed receipt hash", () => {
    const r = formReceipt([committedFunctional, committedPolicy], ctx);
    expect(r.ok).toBe(true);
    expect(String(r.receipt_hash), "recomputed receipt hash must equal committed").toBe(String(committedReceipt.content_hash));
  });

  test("[T2.4] signatures verify (public keys only)", () => {
    expect(verifyDecisionSignature("verifier:gp3-functional", String(committedFunctional.content_hash), committedFunctional.signature)).toBe(true);
    expect(verifyDecisionSignature("verifier:gp3-policy", String(committedPolicy.content_hash), committedPolicy.signature)).toBe(true);
  });

  test("[T2.5] B1 full signature contract", () => {
    const wrongSigner = { ...committedFunctional.signature, signer: "verifier:gp3-policy" };
    expect(verifyDecisionSignature("verifier:gp3-functional", String(committedFunctional.content_hash), wrongSigner)).toBe(false);
    const wrongKey = { ...committedFunctional.signature, key_id: "wrong" };
    expect(verifyDecisionSignature("verifier:gp3-functional", String(committedFunctional.content_hash), wrongKey)).toBe(false);
    const wrongScheme = { ...committedFunctional.signature, scheme: "secp256k1" };
    expect(verifyDecisionSignature("verifier:gp3-functional", String(committedFunctional.content_hash), wrongScheme)).toBe(false);
  });

  // F3: EXACT gate map per negative fixture
  test("[T2.6] F3: negative fixtures — each reaches its EXACT target gate", () => {
    expect(committedNegatives.length).toBeGreaterThanOrEqual(8);
    for (const fixture of committedNegatives) {
      const name = String(fixture._fixture_name ?? "unnamed");
      const expectedGate = EXPECTED_GATES[name];
      expect(expectedGate, `${name}: must have an expected gate`).toBeDefined();
      const partner = fixture._pair_with === "functional" ? committedFunctional : committedPolicy;
      const result = tryForm([committedFunctional, committedPolicy].includes(partner) && fixture._pair_with === "functional" ? [partner, fixture] : [fixture, partner], ctx);
      expect(result.ok, `${name}: must be rejected`).toBe(false);
      expect(result.reason, `${name}: must hit exactly "${expectedGate}"`).toBe(expectedGate);
    }
  });

  test("[T2.7] B1 authority: forged/wrong/missing signature", () => {
    const forged = { ...committedFunctional, content_hash: "sha256:" + "aa".repeat(32) };
    neg("forged", tryForm([forged, committedPolicy], ctx), "content-hash-mismatch");
    const wrongSig = { ...committedFunctional, signature: { ...committedFunctional.signature, value: Buffer.alloc(64).toString("base64") } };
    neg("wrong-sig", tryForm([wrongSig, committedPolicy], ctx), "signature-invalid");
    const { signature: _ns, ...unsigned } = committedFunctional; void _ns;
    neg("no-sig", tryForm([unsigned, committedPolicy], ctx), "signature-invalid");
  });

  test("[T3.1] scope", () => {
    expect(readdirSync(path.join(repoRoot, "packages/golden-path/evidence"))).toEqual(["9f6610dc-24e9-4e6c-b7c1-67574064d2ae"]);
  });

  test("[T3.2] GP4+ absence", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scan = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? scan(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []);
    for (const f of scan(path.resolve(here, "../src"))) {
      const src = readFileSync(f, "utf8");
      for (const bad of [/SettlementInstruction/, /releaseEscrow/, /transferFunds/, /payOut/, /devnet/i, /solana/i]) {
        expect(bad.test(src), `${f} must not contain ${bad}`).toBe(false);
      }
    }
  });

  test("[T3.3] trust root read-only", () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/keys.ts"), "utf8");
    expect(src.includes("bootstrapKeys")).toBe(false);
    expect(src.includes("generateKeyPairSync")).toBe(false);
    expect(src.includes("writeFileSync")).toBe(false);
  });

  test("[T3.4] F1: install from VERIFIED lockfile (not broken frozen-base)", () => {
    const installCheck = functional.checks.find((c: any) => c.id === "F-install-from-verified-lock");
    expect(installCheck).toBeDefined();
    expect(installCheck!.pass).toBe(true);
    const evidence = functional.checks.find((c: any) => c.id === "F-install-evidence");
    expect(evidence).toBeDefined();
    const detail = JSON.parse(evidence!.detail ?? "{}");
    expect(detail.lockfile_sha256).toMatch(/^sha256:/);
    expect(detail.node).toMatch(/^v/);
  });
});

// EMIT: sign computed decisions + generate negatives + receipt (one step)
describe("[GP3-V6-EMIT]", () => {
  test("[E.1] sign + negatives + receipt", () => {
    if (process.env.GP3_EMIT !== "1") return;
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(negativesDir, { recursive: true });

    // Sign the V6-computed decisions and persist
    const reg = loadRegistry();
    const signWrite = (d: Record<string, any>, role: string, fname: string) => {
      const entry = reg.keys.find((k: any) => k.verifier_id === role);
      if (!entry) throw new Error(`no key for ${role}`);
      const privPem = readFileSync(path.join(pkgDir, "keys", "private", `${entry.key_id}.pem`), "utf8");
      const ch = String(d.content_hash);
      const sig = edSign(null, Buffer.from(ch, "utf8"), privPem).toString("base64");
      const signed = { ...d, signature: { scheme: "ed25519", signer: role, key_id: entry.key_id, value: sig } };
      writeFileSync(path.join(artifactsDir, fname), JSON.stringify(signed, null, 2) + "\n");
      return signed;
    };
    const sf = signWrite(functional.decision, "verifier:gp3-functional", "decision-functional.json");
    const sp = signWrite(policy.decision, "verifier:gp3-policy", "decision-policy.json");
    writeFileSync(path.join(artifactsDir, "decision-functional-unsigned.json"), JSON.stringify(functional.decision, null, 2) + "\n");
    writeFileSync(path.join(artifactsDir, "decision-policy-unsigned.json"), JSON.stringify(policy.decision, null, 2) + "\n");

    // Generate negatives from the SIGNED V6 decisions
    const negs = [
      { name: "policy-invalid-result", mods: { result: "INVALID" }, role: "verifier:gp3-policy" },
      { name: "wrong-bundle-id", mods: { bundle_id: "aaaaaaaa-0000-4000-8000-000000000001" }, role: "verifier:gp3-policy" },
      { name: "wrong-evidence-root", mods: { evidence_root: "sha256:" + "01".repeat(32) }, role: "verifier:gp3-policy" },
      { name: "wrong-policy-hash", mods: { policy_hash: "sha256:" + "02".repeat(32) }, role: "verifier:gp3-policy" },
      { name: "wrong-milestone-revision", mods: { milestone_revision: 2 }, role: "verifier:gp3-policy" },
      { name: "second-functional", mods: { decision_id: "00000000-0000-4000-8000-00000000000f" }, role: "verifier:gp3-functional" },
      { name: "attacker-verifier", mods: { verifier_id: "verifier:attacker", decision_id: "00000000-0000-4000-8000-0000000000aa" }, role: "verifier:gp3-policy" },
    ];
    for (const neg of negs) {
      const base = neg.role === "verifier:gp3-functional" ? sf : sp;
      let fixture: Record<string, any>;
      if (neg.name === "attacker-verifier") {
        // Sign with policy key but claim attacker identity — structurally valid
        // signature object, but no registered key for "verifier:attacker"
        const sealed = seal(VerificationDecisionSchema as never, (() => {
          const spread: Record<string, any> = { ...sp, ...neg.mods }; const { content_hash: _c, signature: _s, ...b } = spread; void _c; void _s;
          return b;
        })()) as any;
        fixture = { ...sealed, signature: { scheme: "ed25519", signer: "verifier:attacker", key_id: "attacker-key", value: Buffer.alloc(64).toString("base64") } };
      } else {
        fixture = buildSignedNegative(base, neg.mods, neg.role);
      }
      writeFileSync(path.join(negativesDir, `${neg.name}.json`), JSON.stringify({ ...fixture, _fixture_name: neg.name, _pair_with: "functional" }, null, 2) + "\n");
    }
    // copied-signature: policy body with functional's signature
    writeFileSync(path.join(negativesDir, "copied-signature.json"), JSON.stringify({ ...sp, signature: sf.signature, _fixture_name: "copied-signature", _pair_with: "functional" }, null, 2) + "\n");

    // Receipt from the signed decisions
    const r = formReceipt([sf, sp], ctx);
    if (!r.ok) throw new Error(`receipt failed: ${r.reason}`);
    writeFileSync(path.join(artifactsDir, "receipt.json"), JSON.stringify(r.receipt, null, 2) + "\n");
  }, 300_000);
});
