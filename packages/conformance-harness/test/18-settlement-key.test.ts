import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { fakeHash } from "../src/lib/fixtures.js";
import { refSettlementKey } from "../src/reference/hash.js";
import { sut } from "../src/sut.js";
import golden from "../vectors/settlement-key-vector.json";

const CASE = {
  outcome_receipt_hash: "sha256:adadadadadadadadadadadadadadadadadadadadadadadadadadadadadadadad",
  escrow_ref: "escrow:sim-0001",
  nonce: 7,
} as const;

/**
 * SETTLEMENT KEY — FROZEN byte protocol (Builder B, B-TC4).
 *
 * Normative source: docs/TRUST-CHAIN.md @ e28a22e (COMMANDER-RULED / G1
 * NORMATIVE):
 *
 *   settlement_key = SHA256(
 *     "intent-protocol/v1/settlement-key" || 0x00
 *     || outcome_receipt_hash[32]
 *     || UTF8(escrow_ref) || 0x00
 *     || nonce_u64be[8]
 *   )
 *
 * The key binds the RECEIPT — the protocol's settlement authority — never a
 * raw VerificationDecision / proof_binding. Like R9, three independent
 * implementations must agree byte-exactly:
 *
 *   (1) the TypeScript oracle  (src/reference/hash.ts, node:crypto only)
 *   (2) the Python KAT         (scripts/kat-settlement-key.py, hashlib only)
 *   (3) the SUT                (sut.hash.settlementKey)
 *
 * (1)===(2) is pinned by the golden vector, whose `expected` was computed by
 * the Python implementation first. Any SUT that implements the superseded
 * preimage (proof_binding-keyed, no domain prefix) fails here — that is a
 * finding, not a harness defect.
 */
describe("[SETTLEMENT-KEY] B-TC4 frozen byte protocol — three-way exact agreement", () => {

  test("[S-SKEY-01] TS oracle reproduces the Python-computed golden vector; every input separates; u64 boundaries exact", () => {
    expect(CASE, "golden vector case drift").toEqual(golden.case);
    expect(golden.domain, "frozen domain literal drift").toBe("intent-protocol/v1/settlement-key");
    expect(refSettlementKey(CASE), "oracle vs golden KAT (Python-computed)").toBe(golden.expected);
    // sensitivity: each distinct input must move the key
    expect(refSettlementKey({ ...CASE, outcome_receipt_hash: fakeHash("ff") }), "outcome_receipt_hash sensitivity").not.toBe(golden.expected);
    expect(refSettlementKey({ ...CASE, escrow_ref: "escrow:sim-0002" }), "escrow_ref sensitivity").not.toBe(golden.expected);
    expect(refSettlementKey({ ...CASE, nonce: 8 }), "nonce sensitivity").not.toBe(golden.expected);
    // the 0x00 terminator makes the encoding injective: escrow_ref is recovered exactly
    expect(refSettlementKey({ ...CASE, escrow_ref: "escrow:sim-0001\x00" }), "trailing-NUL escrow_ref must not collide with the terminated form").not.toBe(golden.expected);
    // u64 boundaries
    expect(refSettlementKey({ ...CASE, nonce: 0 })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(refSettlementKey({ ...CASE, nonce: 0xffffffffffffffffn })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() => refSettlementKey({ ...CASE, nonce: 0x10000000000000000n as unknown as bigint })).toThrow(RangeError);
    // malformed receipt hash (not 32 bytes) must be rejected by the oracle
    expect(() => refSettlementKey({ ...CASE, outcome_receipt_hash: "sha256:abcd" })).toThrow();
  });

  test("[S-SKEY-02] SUT === oracle === golden vector: a settlementKey implementing any other preimage FAILS", () => {
    const sutKey = sut.hash.settlementKey as ((p: unknown) => string) | undefined;
    expect(sutKey, "settlementKey must be exported by the SUT (sut.hash)").toBeDefined();
    if (!sutKey) return;
    // the SUT must accept the FROZEN parameterization (receipt-keyed) and agree byte-exactly
    let fromSut: string;
    try {
      fromSut = sutKey({ outcome_receipt_hash: CASE.outcome_receipt_hash, escrow_ref: CASE.escrow_ref, nonce: CASE.nonce });
    } catch (e) {
      throw new Error(`SUT settlementKey does not accept the FROZEN receipt-keyed parameterization (outcome_receipt_hash, escrow_ref, nonce): ${(e as Error).message}`);
    }
    expect(fromSut, "SUT settlement_key must equal the frozen-formula oracle (superseded proof_binding-keyed preimage is a FAIL)").toBe(golden.expected);
    expect(sutKey({ outcome_receipt_hash: fakeHash("ff"), escrow_ref: CASE.escrow_ref, nonce: CASE.nonce }),
      "SUT key must separate on outcome_receipt_hash").not.toBe(fromSut);
    expect(sutKey({ outcome_receipt_hash: CASE.outcome_receipt_hash, escrow_ref: "escrow:sim-0002", nonce: CASE.nonce }),
      "SUT key must separate on escrow_ref").not.toBe(fromSut);
    expect(sutKey({ outcome_receipt_hash: CASE.outcome_receipt_hash, escrow_ref: CASE.escrow_ref, nonce: 8n }),
      "SUT key must separate on nonce").not.toBe(fromSut);
  });

  test("[S-SKEY-KAT] independent Python KAT re-derives the golden vector (third implementation, hashlib only)", () => {
    const katPath = fileURLToPath(new URL("../scripts/kat-settlement-key.py", import.meta.url));
    // probe before use: on Windows `python3` can be the Store alias stub, which
    // "runs" but exits 9009 (command not found) for every invocation.
    const usable = (bin: string): boolean => {
      const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
      return !probe.error && probe.status === 0;
    };
    let ran = false;
    for (const bin of ["python3", "python"]) {
      if (!usable(bin)) continue;
      const r = spawnSync(bin, [katPath], { encoding: "utf8" });
      ran = true;
      expect(r.status, `python KAT exit status (${bin})`).toBe(0);
      expect(String(r.stdout) + String(r.stderr), "python KAT output").toContain("settlement-key golden KAT ok");
      break;
    }
    expect(ran, "no Python interpreter found — the independent third implementation cannot run, so three-way evidence cannot be produced").toBe(true);
  });
});
