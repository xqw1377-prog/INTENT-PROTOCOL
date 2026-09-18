import { z } from "zod";

/** Evidence bundle lifecycle: only the seam between OPEN and SEALED is frozen at S0 (§6, §7). */
export const EvidenceBundleState = z.enum(["OPEN", "SEALED"]);
export type EvidenceBundleState = z.infer<typeof EvidenceBundleState>;

/** Verifier outcome (WP §6.2). DISPUTED is a first-class result, not a state machine hack. */
export const DecisionResult = z.enum(["VALID", "INVALID", "INSUFFICIENT", "DISPUTED"]);
export type DecisionResult = z.infer<typeof DecisionResult>;

/** Chain Adapter finality vocabulary (§10.3); schema-level only, no settlement logic in S0. */
export const Finality = z.enum(["FINAL", "PENDING", "REORGED", "UNKNOWN"]);
export type Finality = z.infer<typeof Finality>;
