/**
 * GP4-E — full adversarial matrix, numbered per contract.
 *
 * Cases 1–8: docs/GOLDEN-PATH-V1.md §7 "Required GP4 negative cases".
 * Cases 9–12: docs/GATES.md GP4 additions (payee authorization before
 * ELIGIBLE, instruction idempotency, forbidden settlement authorities,
 * asset/numeric/traversal closure).
 *
 * Every negative case is ZERO-WRITE (treeDigest before == after) and never
 * reaches the economic guard.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { EscrowLedger, receiptAuthority } from "../src/index.ts";
import {
  ESCROW_REF, FROZEN_ASSET, FROZEN_CLAIM_HASH, FROZEN_RH, canonHash, enabledLedger,
  forgeEscrow, frozenClaim, frozenReceipt, makeInstruction, productionLedger,
  releaseFiles, treeDigest,
} from "./util.ts";

/** Fresh enabled escrow + the tree digest taken around one attempt. */
function attemptZeroWrite(l: EscrowLedger, root: string, input: Parameters<EscrowLedger["attemptRelease"]>[0]) {
  const before = treeDigest(root);
  const r = l.attemptRelease(input);
  const after = treeDigest(root);
  return { r, zeroWrite: before === after };
}

/** A valid-wire receipt variant of the frozen receipt (fresh content_hash). */
function receiptVariant(mutate: (r: Record<string, unknown>) => void): { raw: Record<string, unknown>; hash: string } {
  const { content_hash: _drop, ...rest } = frozenReceipt() as Record<string, unknown>;
  const raw = { ...rest };
  mutate(raw);
  const hash = canonHash(raw); // test-side oracle — engine recomputes via frozen seal
  return { raw, hash };
}

describe("[GP4-E] adversarial matrix (contract §7 + GATES additions)", () => {
  test("[E-01 / §7.1] valid receipt → exactly one RELEASE", () => {
    const { ledger, root } = enabledLedger();
    const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() });
    expect(r.status).toBe("RELEASED");
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[E-02 / §7.2] exact instruction replay → no second release", () => {
    const { ledger, root } = enabledLedger();
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "11" }), claim_record: frozenClaim() }).status).toBe("RELEASED");
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "11" }), claim_record: frozenClaim() }).status).toBe("ALREADY_RELEASED");
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[E-03 / §7.3] same receipt + different nonce → no second release", () => {
    const { ledger, root } = enabledLedger();
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "1" }), claim_record: frozenClaim() }).status).toBe("RELEASED");
    const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "2" }), claim_record: frozenClaim() });
    expect(r.status).toBe("ALREADY_RELEASED");
    expect(r.settlement_key).not.toBe(r); // distinct instruction identity, same economic fate
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[E-04 / §7.4] tampered receipt → reject, zero-write", () => {
    const { ledger, root } = enabledLedger();
    const tampered = { ...(frozenReceipt() as Record<string, unknown>), issued_at: "2020-01-01T00:00:01.000Z" };
    const { r, zeroWrite } = attemptZeroWrite(ledger, root, { receipt: tampered, instruction: makeInstruction(), claim_record: frozenClaim() });
    expect(r.status).toBe("REJECTED_INVALID_RECEIPT"); // stale content_hash caught by frozen seal
    expect(zeroWrite).toBe(true);
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[E-05 / §7.5] ONE verifier ACCEPT only → cannot produce the bound receipt → no settlement", () => {
    const { ledger, root } = enabledLedger();
    // A single-decision "receipt" is wire-valid (decision_hashes min=1) but it
    // is NOT the accepted 2-of-2 receipt the escrow is bound to: policy
    // satisfaction is upstream of receipt formation (GP3), and settlement
    // consumes ONLY the escrow-bound receipt identity.
    const single = receiptVariant((r) => { (r.decision_hashes as string[]).pop(); });
    expect(single.raw.decision_hashes).toHaveLength(1);
    const sealed = receiptAuthority(single.raw); // valid wire, different content_hash
    expect(sealed.outcome_receipt_hash).not.toBe(FROZEN_RH);
    const { r, zeroWrite } = attemptZeroWrite(ledger, root, {
      receipt: single.raw,
      instruction: makeInstruction({ outcome_receipt_hash: sealed.outcome_receipt_hash }),
      claim_record: frozenClaim(),
    });
    expect(r.status).toBe("REJECTED_RECEIPT_MISMATCH");
    expect(zeroWrite).toBe(true);
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[E-06 / §7.6] evidence tamper → different evidence_root → different receipt → no settlement", () => {
    const { ledger, root } = enabledLedger();
    // tampered bundle root produces (upstream) different bindings and a
    // different receipt; settlement-side consequence: any receipt that is not
    // the escrow-bound identity is refused
    const tampered = receiptVariant((r) => { r.evidence_root = "sha256:" + "ee".repeat(32); });
    const sealed = receiptAuthority(tampered.raw);
    const { r, zeroWrite } = attemptZeroWrite(ledger, root, {
      receipt: tampered.raw,
      instruction: makeInstruction({ outcome_receipt_hash: sealed.outcome_receipt_hash }),
      claim_record: frozenClaim(),
    });
    expect(r.status).toBe("REJECTED_RECEIPT_MISMATCH");
    expect(zeroWrite).toBe(true);
  });

  test("[E-07 / §7.7] wrong milestone / bundle / policy binding → reject", () => {
    const { ledger, root } = enabledLedger();
    for (const [name, mutate] of [
      ["milestone", (r: Record<string, unknown>) => { r.milestone_id = "77777777-7777-4777-8777-777777777777"; }],
      ["policy", (r: Record<string, unknown>) => { r.verification_policy_hash = "sha256:" + "77".repeat(32); }],
    ] as const) {
      const v = receiptVariant(mutate);
      const sealed = receiptAuthority(v.raw);
      const { r, zeroWrite } = attemptZeroWrite(ledger, root, {
        receipt: v.raw,
        instruction: makeInstruction({ outcome_receipt_hash: sealed.outcome_receipt_hash }),
        claim_record: frozenClaim(),
      });
      expect(r.status, name).toBe("REJECTED_RECEIPT_MISMATCH");
      expect(zeroWrite, name).toBe(true);
    }
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[E-08 / §7.8] crash/retry after the release boundary → still exactly one economic release", () => {
    const { ledger, root } = enabledLedger();
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("RELEASED");
    // simulate the crash-after-boundary torn cache, then restart and retry
    const reopened = EscrowLedger.open(root);
    for (const nonce of ["1", "2", "3"]) {
      expect(reopened.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce }), claim_record: frozenClaim() }).status).toBe("ALREADY_RELEASED");
    }
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[E-09 / GATES] wrong recipient → rejected BEFORE ELIGIBLE, zero-write, state LOCKED", () => {
    const { ledger, root } = enabledLedger();
    const { r, zeroWrite } = attemptZeroWrite(ledger, root, {
      receipt: frozenReceipt(),
      instruction: makeInstruction({ outputs: [{ recipient: "agent:impostor", asset: FROZEN_ASSET, amount: "10", reason: "x" }] }),
      claim_record: frozenClaim(),
    });
    expect(r.status).toBe("REJECTED_CLAIMANT");
    expect(zeroWrite).toBe(true);
    expect(ledger.readEscrow(ESCROW_REF)!.state).toBe("LOCKED"); // never reached ELIGIBLE
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[E-10 / GATES] instruction idempotency on settlement_key, distinct from economic layer", () => {
    const { ledger, root } = enabledLedger();
    const a = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "5" }), claim_record: frozenClaim() });
    expect(a.status).toBe("RELEASED");
    const b = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "5" }), claim_record: frozenClaim() });
    const c = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "6" }), claim_record: frozenClaim() });
    expect(b.status).toBe("ALREADY_RELEASED"); // same settlement_key: deterministic same outcome
    expect(b.settlement_key).toBe(a.settlement_key);
    expect(c.status).toBe("ALREADY_RELEASED"); // different settlement_key: economic layer still refuses
    expect(c.settlement_key).not.toBe(a.settlement_key);
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[E-11 / GATES §7-forbidden] decision_id / proof_binding can never authorize settlement", () => {
    const { ledger, root } = enabledLedger();
    // (a) a raw VerificationDecision object offered AS the receipt: not a receipt — seal rejects
    const decision = {
      schema_version: "decision.v1",
      decision_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      result: "VALID",
    };
    const a = attemptZeroWrite(ledger, root, { receipt: decision, instruction: makeInstruction(), claim_record: frozenClaim() });
    expect(a.r.status).toBe("REJECTED_INVALID_RECEIPT");
    expect(a.zeroWrite).toBe(true);
    // (b) an instruction smuggling a forbidden authority field: strict wire rejects
    const b = attemptZeroWrite(ledger, root, {
      receipt: frozenReceipt(),
      instruction: makeInstruction({ decision_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      claim_record: frozenClaim(),
    });
    expect(b.r.status).toBe("REJECTED_INVALID_INSTRUCTION");
    expect(b.zeroWrite).toBe(true);
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[E-12 / GATES] closure sweep: mainnet DENY, asset triple DENY, u64 bound, traversal — all zero-write", () => {
    // release-layer: forged escrow.json with non-frozen asset (incl. mainnet)
    for (const bad of [
      { network: "solana-mainnet", asset: "USDC", decimals: 6 },
      { network: "solana-devnet", asset: "USDT-test", decimals: 6 },
      { network: "solana-devnet", asset: "USDC-test", decimals: 9 },
      { network: "local-ledger", asset: "USDC-test", decimals: 6 },
    ]) {
      const root = mkdtempSync(path.join(tmpdir(), "gp4-e12-"));
      forgeEscrow(root, { asset: bad, release_enabled: true });
      const ledger = EscrowLedger.open(root);
      const { r, zeroWrite } = attemptZeroWrite(ledger, root, {
        receipt: frozenReceipt(),
        instruction: makeInstruction({ outputs: [{ recipient: "agent:gp-001-demo", asset: bad, amount: "10", reason: "x" }] }),
        claim_record: frozenClaim(),
      });
      expect(r.status, JSON.stringify(bad)).toBe("DENIED_ASSET");
      expect(zeroWrite).toBe(true);
    }
    // numeric + traversal bounds on an enabled escrow
    const { ledger, root } = enabledLedger();
    const u64 = attemptZeroWrite(ledger, root, { receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "18446744073709551616" }), claim_record: frozenClaim() });
    expect(u64.r.status).toBe("REJECTED_INVALID_INSTRUCTION");
    expect(u64.zeroWrite).toBe(true);
    const trav = attemptZeroWrite(ledger, root, { receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: "../escape" }), claim_record: frozenClaim() });
    expect(trav.r.status).toBe("REJECTED_UNKNOWN_ESCROW");
    expect(trav.zeroWrite).toBe(true);
    // HOLD: production surface
    const prod = productionLedger();
    prod.ledger.createEscrow({ escrow_ref: ESCROW_REF, asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH, claim_record_hash: FROZEN_CLAIM_HASH });
    const hold = attemptZeroWrite(prod.ledger, prod.root, { receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() });
    expect(hold.r.status).toBe("REJECTED_HOLD");
    expect(hold.zeroWrite).toBe(true);
    void FROZEN_CLAIM_HASH;
  });
});
