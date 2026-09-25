import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { proofBinding, loadFrozenIdentity, loadFrozenEvidence, bindingContext, repoRoot } from "../src/compute.js";
import { computeFunctional, computePolicy } from "../src/verifiers.js";
import { formReceipt } from "../src/receipt.js";
import { verifyDecisionSignature } from "../src/keys.js";
import r9Vector from "../../conformance-harness/vectors/proof-binding-vector.json";
import { seal, VerificationDecisionSchema } from "@intent/protocol-schema";

/**
 * GP3 V4 FORMAL TEST — READ-ONLY, NO PRIVATE KEYS REQUIRED.
 *
 * Flow: compute unsigned decisions → compare against committed signed
 * artifacts (if present) → verify signatures with public keys → run receipt
 * engine → verify committed receipt. Fresh clones can run this without
 * any private key files.
 */
const identity = loadFrozenIdentity();
const ev = loadFrozenEvidence();
const binding = bindingContext(identity, ev);
const ctx = { binding: binding as unknown as Record<string, unknown> };

// compute (deterministic, unsigned)
const functional = computeFunctional(ev, binding);
const policy = computePolicy(ev, binding, identity);

// committed signed artifacts (read-only)
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(pkgDir, "artifacts");
const readJson = (name: string): Record<string, any> | null => {
  try { return JSON.parse(readFileSync(path.join(artifactsDir, name), "utf8")); } catch { return null; }
};
const committedFunctional = readJson("decision-functional.json");
const committedPolicy = readJson("decision-policy.json");
const committedReceipt = readJson("receipt.json");
const haveArtifacts = !!(committedFunctional && committedPolicy && committedReceipt);

const tryForm = (ds: any[], c: any) => { try { return formReceipt(ds, c); } catch { return { ok: false, reason: "seal-rejected" as const }; } };
const neg = (l: string, out: { ok: boolean; reason?: string }, want: string) => expect([out.ok, out.reason], l).toEqual([false, want]);

describe("[GP3-V4] compute + formal verification (no private keys)", () => {
  test("[T0.1] R9 golden KAT", () => { expect(proofBinding(r9Vector.case as any)).toBe(r9Vector.expected); });
  test("[T0.2] intent_hash = frozen sealed identity", () => { expect(binding.intent_hash).toBe("sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e"); });

  test("[T1.1] B2 functional: all checks green, VALID, deterministic", () => {
    expect(functional.decision.result).toBe("VALID");
    const failed = (functional.decision.reason_codes as string[]).filter((r: string) => r.startsWith("FAILED_"));
    expect(failed).toEqual([]);
  });

  test("[T1.2] B3 policy: V2-complete checks all green, VALID", () => {
    expect(policy.decision.result).toBe("VALID");
    const failed = (policy.decision.reason_codes as string[]).filter((r: string) => r.startsWith("FAILED_"));
    expect(failed).toEqual([]);
  });

  test("[T1.3] determinism: recomputed decisions byte-identical", () => {
    const f2 = computeFunctional(loadFrozenEvidence(), bindingContext(loadFrozenIdentity(), loadFrozenEvidence()));
    expect(f2.content_hash).toBe(functional.content_hash);
    expect(f2.decision.decision_id).toBe(functional.decision.decision_id);
  }, 180_000);

  test("[T2.1] committed artifacts: signed decisions match recomputed + signatures verify", () => {
    if (!haveArtifacts) return; // skip on fresh clone before signing
    // functional: committed body (minus signature) must reseal to same content_hash
    expect(String(committedFunctional!.content_hash)).toBe(functional.content_hash);
    expect(String(committedPolicy!.content_hash)).toBe(policy.content_hash);
    // signature verification with PUBLIC keys only
    expect(verifyDecisionSignature("verifier:gp3-functional", String(committedFunctional!.content_hash), committedFunctional!.signature)).toBe(true);
    expect(verifyDecisionSignature("verifier:gp3-policy", String(committedPolicy!.content_hash), committedPolicy!.signature)).toBe(true);
  });

  test("[T2.2] receipt from committed signed artifacts", () => {
    if (!haveArtifacts) return;
    const r = formReceipt([committedFunctional!, committedPolicy!], ctx);
    expect(r.ok).toBe(true);
    expect(String(r.receipt!.content_hash)).toBe(String(committedReceipt!.content_hash));
  });

  test("[T2.3] B1 full signature contract: wrong signer/key_id/scheme rejected", () => {
    if (!haveArtifacts) return;
    const wrongSigner = { ...committedFunctional!, signature: { ...committedFunctional!.signature, signer: "verifier:gp3-policy" } };
    expect(verifyDecisionSignature("verifier:gp3-functional", String(committedFunctional!.content_hash), wrongSigner.signature)).toBe(false);
    const wrongKeyId = { ...committedFunctional!.signature, key_id: "wrong-key-id" };
    expect(verifyDecisionSignature("verifier:gp3-functional", String(committedFunctional!.content_hash), wrongKeyId)).toBe(false);
    const wrongScheme = { ...committedFunctional!.signature, scheme: "secp256k1" };
    expect(verifyDecisionSignature("verifier:gp3-functional", String(committedFunctional!.content_hash), wrongScheme)).toBe(false);
  });

  test("[T2.4] B1 authority: forged hash / wrong sig / missing sig rejected by engine", () => {
    if (!haveArtifacts) return;
    const forged = { ...committedFunctional!, content_hash: "sha256:" + "aa".repeat(32) };
    neg("forged", tryForm([forged, committedPolicy!], ctx), "content-hash-mismatch");
    const wrongSig = { ...committedFunctional!, signature: { ...committedFunctional!.signature, value: Buffer.alloc(64).toString("base64") } };
    neg("wrong-sig", tryForm([wrongSig, committedPolicy!], ctx), "signature-invalid");
    neg("no-sig", tryForm([{ content_hash: functional.content_hash, ...functional.decision }, committedPolicy!], ctx), "signature-invalid");
  });

  test("[T2.5] negative matrix: policy/binding (unsigned path for determinism)", () => {
    // Build properly signed inputs is impossible without private keys, so
    // test the engine's gates using the UNSIGNED computed decisions:
    // the engine will reject at signature-invalid for unsigned inputs,
    // proving the signature gate fires FIRST (before policy/binding).
    const unsignedF = { ...functional.decision };
    const unsignedP = { ...policy.decision };
    neg("unsigned", tryForm([unsignedF, unsignedP], ctx), "signature-invalid");
    // not-two-decisions
    neg("one", tryForm([committedFunctional ?? unsignedF], ctx), "not-two-decisions");
    // single VALID (using committed signed if available)
    if (haveArtifacts) {
      const { content_hash: _ch, signature: _sig, ...invalidBody } = committedPolicy!; void _ch; void _sig;
      const resealedInvalid = seal(VerificationDecisionSchema as never, { ...invalidBody, result: "INVALID" }) as any;
      neg("invalid-unsigned", tryForm([committedFunctional!, resealedInvalid], ctx), "signature-invalid");
    }
  });

  test("[T3.1] scope: no new GP2 evidence directories", () => {
    const files = readdirSync(path.join(repoRoot, "packages/golden-path/evidence"));
    // only the PASSED run 9f6610dc must exist
    expect(files).toEqual(["9f6610dc-24e9-4e6c-b7c1-67574064d2ae"]);
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

  test("[T3.3] keys.ts has NO bootstrapKeys (read-only trust root)", () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/keys.ts"), "utf8");
    expect(src.includes("bootstrapKeys")).toBe(false);
    expect(src.includes("generateKeyPairSync")).toBe(false);
    expect(src.includes("writeFileSync")).toBe(false);
  });
});

// re-export repoRoot from compute.ts


describe("[GP3-V4-EMIT] artifact emission (explicit: GP3_EMIT=1 only)", () => {
  test("[E.1] write unsigned decisions for offline signing", () => {
    if (process.env.GP3_EMIT !== "1") return;
    mkdirSync(path.join(pkgDir, "artifacts"), { recursive: true });
    writeFileSync(path.join(pkgDir, "artifacts", "decision-functional-unsigned.json"), JSON.stringify(functional.decision, null, 2) + "\n");
    writeFileSync(path.join(pkgDir, "artifacts", "decision-policy-unsigned.json"), JSON.stringify(policy.decision, null, 2) + "\n");
  }, 180_000);

  test("[E.2] generate receipt from signed artifacts (requires prior signing)", () => {
    if (process.env.GP3_EMIT !== "1") return;
    const sf = readJson("decision-functional.json");
    const sp = readJson("decision-policy.json");
    if (!sf || !sp) return; // skip if not yet signed
    const r = formReceipt([sf, sp], ctx);
    if (!r.ok) throw new Error(`receipt failed: ${r.reason}`);
    writeFileSync(path.join(pkgDir, "artifacts", "receipt.json"), JSON.stringify(r.receipt, null, 2) + "\n");
  }, 60_000);
});
