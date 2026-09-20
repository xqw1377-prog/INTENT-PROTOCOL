/**
 * Builder D delta re-audit (GP0 amendment a1d9749): executable semantics of
 * the §7 "GP-001 payee binding" — derived from the amended contract text
 * only, independent of any Builder C implementation.
 *
 * A conforming GP-001 SettlementInstruction MUST satisfy ALL of:
 *   outputs.length == 1
 *   outputs[0].recipient == ClaimRecord.claimant   (exact SubjectRef string equality)
 *   outputs[0].asset == {network:"solana-devnet", asset:"USDC-test", decimals:6}
 *   outputs[0].amount == "10"
 *   total_amount == "10"
 *   escrow_ref == TaskFreezeRecord.escrow_ref
 * Any violation MUST be rejected before settlement becomes ELIGIBLE.
 */

export interface GPTaskFreezeRecord {
  escrow_ref: string;
  asset: { network: string; asset: string; decimals: number };
  reward: string;
}

export interface GPClaimRecord {
  claimant: string;
  task_freeze_hash: string;
}

export interface GPSettlementInstruction {
  escrow_ref: string;
  outputs: Array<{ recipient: string; asset: { network: string; asset: string; decimals: number }; amount: string }>;
  total_amount: string;
}

const SUBJECT_REF_RE = /^(user|org|agent|verifier|arbitrator|service|operator):[A-Za-z0-9._-]{1,128}$/;

export function isSubjectRef(v: unknown): v is string {
  return typeof v === "string" && SUBJECT_REF_RE.test(v);
}

export type PayeeViolation =
  | "outputs-not-single"
  | "recipient-mismatch"
  | "asset-mismatch"
  | "amount-mismatch"
  | "total-mismatch"
  | "escrow-mismatch"
  | "claimant-not-subjectref"
  | "claim-task-freeze-drift";

/** Returns [] iff the instruction conforms; otherwise the violations that MUST block ELIGIBLE. */
export function payeeBindingViolations(
  s: GPSettlementInstruction,
  claim: GPClaimRecord,
  task: GPTaskFreezeRecord,
  expectedTaskFreezeHash: string,
): PayeeViolation[] {
  const v: PayeeViolation[] = [];
  if (!isSubjectRef(claim.claimant)) v.push("claimant-not-subjectref");
  if (claim.task_freeze_hash !== expectedTaskFreezeHash) v.push("claim-task-freeze-drift");
  if (s.outputs.length !== 1) { v.push("outputs-not-single"); return v; }
  const o = s.outputs[0]!;
  if (o.recipient !== claim.claimant) v.push("recipient-mismatch");
  const a = o.asset;
  if (a.network !== task.asset.network || a.asset !== task.asset.asset || a.decimals !== task.asset.decimals) v.push("asset-mismatch");
  if (o.amount !== task.reward) v.push("amount-mismatch");
  if (s.total_amount !== task.reward) v.push("total-mismatch");
  if (s.escrow_ref !== task.escrow_ref) v.push("escrow-mismatch");
  return v;
}
