/**
 * GP4-F — settlement evidence sealing + reverse traceability.
 *
 * Every link in the sealed evidence record must resolve to a COMMITTED
 * FROZEN artifact in this repository (not to anything the ledger itself
 * asserts): intent.json, milestone.json, the GP2 evidence bundle, the GP3
 * receipt artifact, the frozen task bytes, and the committed ClaimRecord
 * fixture.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { settlementKey } from "@intent/protocol-schema";
import { buildSettlementEvidence, sealSettlementEvidence, verifySettlementEvidence } from "../src/index.ts";
import { ESCROW_REF, FROZEN_RH, canonHash, enabledLedger, frozenClaim, frozenReceipt, makeInstruction, releaseFiles } from "./util.ts";

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
}

describe("[GP4-F] settlement evidence sealing + reverse traceability", () => {
  test("[F-01] sealed evidence: EVERY reverse link resolves to a committed frozen artifact", () => {
    const { ledger } = enabledLedger();
    const rel = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "4" }), claim_record: frozenClaim() });
    expect(rel.status).toBe("RELEASED");
    const ev = buildSettlementEvidence(ledger, ESCROW_REF, { receipt: frozenReceipt(), claim_record: frozenClaim() });
    const links = ev.links;

    // receipt artifact (GP2/GP3 committed output)
    const receiptArt = readJson("../../../packages/gp3-verification/artifacts/receipt.json");
    expect(receiptArt.content_hash).toBe(ev.outcome_receipt_hash);
    // intent (frozen identity)
    const intent = readJson("../../../packages/golden-path/identity/intent.json");
    expect(intent.content_hash).toBe(links.intent_hash);
    // milestone (frozen identity)
    const milestone = readJson("../../../packages/golden-path/identity/milestone.json");
    expect(milestone.milestone_id).toBe(links.milestone_id);
    expect(milestone.milestone_revision).toBe(links.milestone_revision);
    expect(milestone.intent_hash).toBe(links.intent_hash);
    // evidence bundle (committed GP2 output): merkle root link
    const bundle = readJson("../../../packages/golden-path/evidence/9f6610dc-24e9-4e6c-b7c1-67574064d2ae/bundle.json");
    expect(bundle.merkle_root).toBe(links.evidence_root);
    // claim fixture (committed)
    const claim = frozenClaim();
    expect(canonHash(claim)).toBe(ev.claim_record_hash);
    expect(claim.task_freeze_hash).toBe(links.task_freeze_hash);
    expect(claim.claimant).toBe(links.claimant);
    expect(claim.bounty_id).toBe(links.bounty_id);
    // task freeze hash == exact bytes of the frozen task fixture
    const taskBytes = readFileSync(new URL("../../../packages/golden-path/fixtures/gp-001-task.json", import.meta.url));
    expect("sha256:" + createHash("sha256").update(taskBytes).digest("hex")).toBe(links.task_freeze_hash);
    // release: the single economic release, key re-derivable from the journal nonce
    expect(ev.release).not.toBeNull();
    expect(ev.release!.outcome_receipt_hash).toBe(FROZEN_RH);
    expect(ev.instructions).toHaveLength(1);
    expect(ev.release!.settlement_key).toBe(
      settlementKey({ outcome_receipt_hash: FROZEN_RH, escrow_ref: ESCROW_REF, nonce: BigInt(ev.instructions[0]!.nonce) }));
    expect(ev.escrow_state).toBe("RELEASED");
  });

  test("[F-02] evidence seal: deterministic hash, file written atomically, verifier recomputes true", () => {
    const { ledger, root } = enabledLedger();
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("RELEASED");
    const a = buildSettlementEvidence(ledger, ESCROW_REF, { receipt: frozenReceipt(), claim_record: frozenClaim() });
    const b = buildSettlementEvidence(ledger, ESCROW_REF, { receipt: frozenReceipt(), claim_record: frozenClaim() });
    expect(a.evidence_hash).toBe(b.evidence_hash); // deterministic (timestamps excluded? produced_at differs if clock moves — fixed clock in test ledger)
    expect(a.evidence_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const sealed = sealSettlementEvidence(ledger, ESCROW_REF, { receipt: frozenReceipt(), claim_record: frozenClaim() });
    const onDisk = JSON.parse(readFileSync(sealed.file, "utf8"));
    expect(verifySettlementEvidence(onDisk)).toBe(true);
    expect(onDisk.evidence_hash).toBe(a.evidence_hash);
    // re-seal over existing snapshot: atomic replace, still verifies
    const again = sealSettlementEvidence(ledger, ESCROW_REF, { receipt: frozenReceipt(), claim_record: frozenClaim() });
    expect(JSON.parse(readFileSync(again.file, "utf8")).evidence_hash).toBe(a.evidence_hash);
    void root;
    expect(releaseFiles(root)).toHaveLength(1); // sealing never adds economic releases
  });

  test("[F-03] tampered evidence record → third-party verifier returns false", () => {
    const { ledger } = enabledLedger();
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("RELEASED");
    const ev = buildSettlementEvidence(ledger, ESCROW_REF, { receipt: frozenReceipt(), claim_record: frozenClaim() });
    expect(verifySettlementEvidence(ev)).toBe(true);
    for (const tamper of [
      (e: Record<string, unknown>) => { (e.release as Record<string, unknown> | null)!.amount = "999"; },
      (e: Record<string, unknown>) => { delete e.evidence_hash; },
      (e: Record<string, unknown>) => { e.evidence_hash = "sha256:" + "00".repeat(32); },
      (e: Record<string, unknown>) => { (e.links as Record<string, unknown>).claimant = "agent:impostor"; },
    ]) {
      const copy = JSON.parse(JSON.stringify(ev)) as Record<string, unknown>;
      tamper(copy);
      expect(verifySettlementEvidence(copy)).toBe(false);
    }
  });

  test("[F-04] evidence on an UNRELEASED escrow: release null, state LOCKED, seal still valid", () => {
    const { ledger } = enabledLedger();
    const ev = buildSettlementEvidence(ledger, ESCROW_REF, { receipt: frozenReceipt(), claim_record: frozenClaim() });
    expect(ev.release).toBeNull();
    expect(ev.escrow_state).toBe("LOCKED");
    expect(ev.instructions).toHaveLength(0);
    expect(verifySettlementEvidence(ev)).toBe(true);
  });

  test("[F-05] binding mismatch inputs → evidence builder refuses (no forged chain)", () => {
    const { ledger } = enabledLedger();
    const wrongReceipt = { ...(frozenReceipt() as Record<string, unknown>), receipt_id: "99999999-9999-4999-8999-999999999999" };
    delete (wrongReceipt as Record<string, unknown>).content_hash;
    expect(() => buildSettlementEvidence(ledger, ESCROW_REF, { receipt: wrongReceipt, claim_record: frozenClaim() })).toThrow(/mismatch|content_hash/);
    const wrongClaim = { ...frozenClaim(), claimant: "agent:other" };
    expect(() => buildSettlementEvidence(ledger, ESCROW_REF, { receipt: frozenReceipt(), claim_record: wrongClaim })).toThrow(/mismatch/);
  });
});
