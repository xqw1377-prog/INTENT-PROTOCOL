/**
 * R1 remediation — the EXPLICIT local-verification override entry point.
 *
 * Production API (EscrowLedger.createEscrow) is hold-by-construction: no
 * caller input can ever produce release_enabled=true. The ONLY way to
 * create a release-enabled escrow for local gate testing is this separate,
 * explicitly-named class and its explicitly-named method. It exists so the
 * GP4-B guard/race tests can exercise the release path; it is never to be
 * called by production settlement code paths.
 */
import { EscrowLedger } from "./ledger.ts";
import type { CreateEscrowInput } from "./ledger.ts";
import type { EscrowEntry } from "./schema.ts";

export class LocalVerificationLedger extends EscrowLedger {
  /** Open (and repair) a local verification ledger. */
  static override open(root: string, opts?: { now?: () => number }): LocalVerificationLedger {
    const ledger = new LocalVerificationLedger(root, opts);
    ledger.reopen();
    return ledger;
  }

  /**
   * Create a release-enabled escrow FOR LOCAL VERIFICATION ONLY.
   * Distinct name, distinct class: it cannot be invoked "accidentally"
   * through the production surface, and review/grep can find every caller.
   */
  createEscrowForVerification(input: CreateEscrowInput):
    | { status: "CREATED"; entry: EscrowEntry }
    | { status: "ESCROW_EXISTS" }
    | { status: "REJECTED_INVALID"; reason: string } {
    return this.createEscrowWithPolicy(input, true);
  }
}
