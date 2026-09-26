/**
 * GP4 — receipt canonical source.
 *
 * The settlement authority identity is the accepted OutcomeReceiptV1
 * content_hash computed by the FROZEN G1 seal (packages/protocol-schema,
 * subtree bb14d937). There is NO second identity derivation in this package:
 *
 *   - input is the frozen GP3/GP2 output artifact (untrusted bytes)
 *   - the frozen seal parses against frozen OutcomeReceiptSchema and REJECTS
 *     a declared content_hash that does not match the recomputed hash
 *     (tamper check happens inside the frozen library, before any field of
 *     the receipt is used as authority)
 *   - outcome_receipt_hash := receipt.content_hash — that hash, nothing else
 *
 * Forbidden authorities (GOLDEN-PATH-V1.md §7) never appear here:
 * decision_id, proof_binding, manual/admin/demo flags.
 */
import { OutcomeReceiptSchema } from "@intent/protocol-schema";
import type { Hash, OutcomeReceipt } from "@intent/protocol-schema";
import { frozenSeal } from "./frozen.ts";

export interface ReceiptAuthority {
  receipt: OutcomeReceipt;
  outcome_receipt_hash: Hash;
}

/** Validate + derive the settlement authority hash from a receipt object. */
export function receiptAuthority(input: unknown): ReceiptAuthority {
  const receipt = frozenSeal(OutcomeReceiptSchema, input);
  return { receipt, outcome_receipt_hash: receipt.content_hash };
}
