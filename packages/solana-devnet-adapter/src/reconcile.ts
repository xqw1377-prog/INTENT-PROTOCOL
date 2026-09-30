/**
 * TESTNET-R1 / T4 — UNKNOWN_CHAIN_STATE reconciliation.
 *
 * T2 proved: failure/retry/concurrency cannot create a SECOND economic
 * release. T4 proves the complementary discipline: when the client does not
 * know whether its transaction landed, the system recovers to a definite
 * terminal state — and the frozen invariant holds:
 *
 *   UNKNOWN ≠ permission to submit again blindly.
 *
 * Only a reconciliation that conclusively classifies NOT_LANDED (transaction
 * expired without landing) carries safeToRetry = true. Everything else —
 * RELEASED, REJECTED, STILL_UNKNOWN — FORBIDS resubmission.
 *
 * This module is ADAPTER-ONLY state (T0 §8); the frozen GP4 state machine is
 * untouched. No verification, no OutcomeReceipt reformation, no new protocol
 * objects — observation and classification only.
 */

/** Terminal chain-state classifications (T4 order, frozen). */
export type ChainStateClassification =
  | "RELEASED"      // the economic release fact exists on chain
  | "REJECTED"      // the submitted tx landed and was REJECTED (e.g. Custom 108 DuplicateRelease)
  | "NOT_LANDED"    // the tx can provably never land (expired) — the ONLY safe-retry class
  | "STILL_UNKNOWN"; // may still be in flight — resubmission FORBIDDEN

/** Adapter-owned lifecycle states (T0 §8). GP4's machine is untouched. */
export type AdapterState = "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FINALIZED" | "UNKNOWN" | "RECONCILED";

export interface ChainObservation {
  /** release PDA fact (per EconomicReleaseKey) */
  releasePda: { initialized: boolean; amountBase: string | null };
  claimantBalance: string;
  treasuryBalance: string;
  capsCycleReleased: string | null;
  /** submitted signature status, when a signature is known */
  signature: {
    known: boolean;
    found: boolean;
    slot?: number | null;
    confirmationStatus?: string | null;
    err?: string | null; // null = success; JSON string of the tx error otherwise
  } | null;
  lastValidBlockHeight: number | null;
  currentBlockHeight: number;
}

export interface ReconcileResult {
  classification: ChainStateClassification;
  safeToRetry: boolean;
  reason: string;
  observation: ChainObservation;
}

/**
 * The frozen classification rules, pure and deterministic:
 *
 *   R1  release PDA initialized (amount = the frozen 10) → RELEASED
 *       — the economic fact exists; client knowledge is irrelevant
 *   R2  signature found + err → REJECTED (chain adjudicated; includes
 *       Custom(108) DuplicateRelease)
 *   R3  signature found + success → RELEASED (a successful release tx must
 *       carry the fact; if the fact is somehow absent → STILL_UNKNOWN)
 *   R4  signature NOT found + block height beyond lastValidBlockHeight →
 *       NOT_LANDED (can never land) — safeToRetry ONLY here
 *   R5  otherwise → STILL_UNKNOWN (in flight) — resubmission FORBIDDEN
 */
export function classify(observation: ChainObservation): ReconcileResult {
  const safe = (classification: ChainStateClassification, reason: string): ReconcileResult => ({
    classification,
    safeToRetry: classification === "NOT_LANDED",
    reason,
    observation,
  });

  // R1 — the on-chain fact outranks everything
  if (observation.releasePda.initialized) {
    return safe("RELEASED", "release PDA initialized: the economic release fact exists on chain");
  }

  if (observation.signature?.known && observation.signature.found) {
    // R2 / R3
    if (observation.signature.err) {
      const isDuplicate = observation.signature.err.includes("108");
      return safe("REJECTED", `submitted tx landed and was rejected on chain${isDuplicate ? " (Custom 108 DuplicateRelease)" : ""}: ${observation.signature.err}`);
    }
    // success without the release fact is not an expected world; stay honest
    return safe("STILL_UNKNOWN", "signature reports success but the release PDA fact is absent — refusing to guess");
  }

  // R4 — provably expired: the tx can never land
  if (
    observation.signature !== null &&
    !observation.signature.found &&
    observation.lastValidBlockHeight !== null &&
    observation.currentBlockHeight > observation.lastValidBlockHeight
  ) {
    return safe("NOT_LANDED", `signature not found and block height ${observation.currentBlockHeight} is past lastValid ${observation.lastValidBlockHeight}: the transaction can never land — safe to retry (subject to caps and pair authorization)`);
  }

  // R5 — in flight or unknowable
  return safe(
    "STILL_UNKNOWN",
    observation.signature?.known
      ? "signature not yet visible on chain and still within its validity window — DO NOT resubmit"
      : "no signature available and no release fact on chain — DO NOT resubmit",
  );
}

/** The frozen invariant as a pure check: UNKNOWN never grants resubmission. */
export function unknownNeverPermitsResubmission(results: ReconcileResult[]): boolean {
  return results.every((r) => r.safeToRetry === (r.classification === "NOT_LANDED"));
}

/**
 * Adapter lifecycle transitions (T0 §8), pure:
 *   PREPARED → SUBMITTED → CONFIRMED → FINALIZED
 *   SUBMITTED → UNKNOWN → RECONCILED
 * Anything else is invalid.
 */
const TRANSITIONS: Record<AdapterState, AdapterState[]> = {
  PREPARED: ["SUBMITTED"],
  SUBMITTED: ["CONFIRMED", "UNKNOWN"],
  CONFIRMED: ["FINALIZED"],
  FINALIZED: [],
  UNKNOWN: ["RECONCILED"],
  RECONCILED: [],
};

export class InvalidTransitionError extends Error {}

export function nextAdapterState(from: AdapterState, to: AdapterState): AdapterState {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(`illegal adapter transition ${from} → ${to}`);
  }
  return to;
}
