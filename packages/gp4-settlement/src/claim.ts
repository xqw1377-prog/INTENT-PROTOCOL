/**
 * GP4-C part B — immutable ClaimRecord authority (payee authorization).
 *
 * The escrow binds ONE claim_record_hash at funding time. attemptRelease
 * consumes a ClaimRecord as UNTRUSTED input, validates it against the frozen
 * GP1 claim grammar, recomputes its canonical binding hash, and rejects any
 * mismatch BEFORE the logical state walk and BEFORE the economic guard
 * (zero persistent mutation). The payee rule (GATES.md GP4):
 *
 *   outputs.length == 1
 *   outputs[0].recipient == ClaimRecord.claimant
 *   amount == escrow.amount ("10" for GP-001)
 *   asset == frozen triple solana-devnet/USDC-test/6
 *
 * The committed GP-001 fixture lives at fixtures/gp-001-claim.json
 * (claimant agent:gp-001-demo, task_freeze_hash of the frozen task file).
 */
import { createHash } from "node:crypto";
import { canonicalize } from "@intent/protocol-schema";
import { ClaimRecordSchema } from "./schema.ts";
import type { ClaimRecord } from "./schema.ts";

export interface ClaimAuthority {
  claim: ClaimRecord;
  claim_record_hash: `sha256:${string}`;
}

/** sha256 of the IPC-JSON-1 canonical bytes (runtime ledger binding). */
export function claimRecordHash(claim: ClaimRecord): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalize(claim), "utf8").digest("hex")}` as `sha256:${string}`;
}

/** Validate a ClaimRecord and derive its binding hash. Throws on shape violations. */
export function claimAuthority(input: unknown): ClaimAuthority {
  const claim = ClaimRecordSchema.parse(input);
  return { claim, claim_record_hash: claimRecordHash(claim) };
}
