/**
 * GP4-F — settlement evidence sealing + reverse traceability.
 *
 * buildSettlementEvidence() joins the escrow ledger state with the frozen
 * upstream authorities (receipt + claim, consumed as untrusted inputs and
 * re-verified via the frozen G1 seal / canonical claim hash) into ONE
 * sealed record whose `links` carry the complete reverse chain:
 *
 *   release (escrow_ref, outcome_receipt_hash)
 *     → instruction journal (settlement_key, nonce)
 *     → receipt (intent_hash, milestone, evidence_root, policy)
 *     → claim (task_freeze_hash → frozen task bytes, claimant)
 *
 * Every link must resolve to a committed frozen artifact. The record is
 * sealed with canonical-bytes sha256 (`evidence_hash`, excluded from its
 * own preimage) and written atomically next to the escrow entry.
 */
import { createHash } from "node:crypto";
import * as path from "node:path";
import { atomicPublish, atomicReplace } from "./guard.ts";
import { SettlementEvidenceSchema } from "./schema.ts";
import type { EscrowLedger } from "./ledger.ts";
import type { InstructionRecord, ReleaseRecord, SettlementEvidence } from "./schema.ts";
import { receiptAuthority } from "./receipt.ts";
import { claimAuthority } from "./claim.ts";

export interface EvidenceInputs {
  receipt: unknown;
  claim_record: unknown;
}

/** Read the whole instruction journal for an escrow (sorted by filename). */
function readJournal(ledger: EscrowLedger, ref: string): InstructionRecord[] {
  const out: InstructionRecord[] = [];
  for (const f of ledger.listInstructionFiles(ref)) {
    const hex = f.replace(/\.json$/, "");
    const rec = ledger.readInstruction(ref, `sha256:${hex}`);
    if (rec) out.push(rec);
  }
  return out;
}

/** Build the sealed evidence record (does NOT write anything). Throws on binding mismatch. */
export function buildSettlementEvidence(ledger: EscrowLedger, ref: string, inputs: EvidenceInputs, now: () => number = () => Math.floor(Date.now() / 1000)): SettlementEvidence {
  const entry = ledger.readEscrow(ref);
  if (!entry) throw new Error(`unknown escrow: ${ref}`);
  const { receipt, outcome_receipt_hash } = receiptAuthority(inputs.receipt);
  const { claim, claim_record_hash } = claimAuthority(inputs.claim_record);
  if (entry.outcome_receipt_hash !== outcome_receipt_hash) {
    throw new Error(`escrow receipt binding mismatch: ${entry.outcome_receipt_hash} != ${outcome_receipt_hash}`);
  }
  if (entry.claim_record_hash !== claim_record_hash) {
    throw new Error(`escrow claim binding mismatch: ${entry.claim_record_hash} != ${claim_record_hash}`);
  }
  const release: ReleaseRecord | null = ledger.readRelease(ref, outcome_receipt_hash);
  const record: SettlementEvidence = {
    schema_version: "gp4-evidence.v1",
    escrow_ref: entry.escrow_ref,
    asset: entry.asset,
    amount: entry.amount,
    outcome_receipt_hash,
    claim_record_hash,
    escrow_state: entry.state,
    release,
    instructions: readJournal(ledger, ref),
    links: {
      intent_hash: receipt.intent_hash,
      milestone_id: receipt.milestone_id,
      milestone_revision: receipt.milestone_revision,
      evidence_root: receipt.evidence_root,
      verification_policy_hash: receipt.verification_policy_hash,
      task_freeze_hash: claim.task_freeze_hash,
      bounty_id: claim.bounty_id,
      claimant: claim.claimant,
    },
    produced_at: now(),
  };
  return sealEvidence(record);
}

/** Attach the canonical-bytes evidence hash (excluded from its own preimage). */
export function sealEvidence(record: SettlementEvidence): SettlementEvidence {
  const { evidence_hash: _drop, ...preimage } = record;
  void _drop;
  const hash = "sha256:" + createHash("sha256").update(canonicalOf(preimage), "utf8").digest("hex");
  return { ...record, evidence_hash: hash } as SettlementEvidence;
}

/** Recompute and validate a settlement evidence record (third-party verifier entry). */
export function verifySettlementEvidence(record: unknown): boolean {
  const parsed = SettlementEvidenceSchema.safeParse(record);
  if (!parsed.success) return false;
  const { evidence_hash, ...preimage } = parsed.data;
  if (!evidence_hash) return false;
  const recomputed = sealEvidence(preimage as SettlementEvidence).evidence_hash;
  return recomputed === evidence_hash;
}

/** Build + atomically write `settlement-evidence.json` beside the escrow entry. */
export function sealSettlementEvidence(ledger: EscrowLedger, ref: string, inputs: EvidenceInputs): { record: SettlementEvidence; file: string } {
  const record = buildSettlementEvidence(ledger, ref, inputs);
  const file = path.join(ledger.escrowDirPath(ref), "settlement-evidence.json");
  const pub = atomicPublish(path.dirname(file), path.basename(file), Buffer.from(canonicalize(record as Parameters<typeof canonicalize>[0]), "utf8"));
  if (pub.status === "EXISTS") {
    // re-seal over an existing snapshot: replace atomically (idempotent refresh)
    atomicReplace(file, Buffer.from(canonicalize(record as Parameters<typeof canonicalize>[0]), "utf8"));
  }
  return { record, file };
}

// canonicalize import isolated for the seal preimage
import { canonicalize } from "@intent/protocol-schema";
function canonicalOf(v: unknown): string {
  return canonicalize(v as Parameters<typeof canonicalize>[0]);
}
