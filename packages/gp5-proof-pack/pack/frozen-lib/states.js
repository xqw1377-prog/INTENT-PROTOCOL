import { z } from "zod";
/** Evidence bundle lifecycle: only the seam between OPEN and SEALED is frozen at S0 (§6, §7). */
export const EvidenceBundleState = z.enum(["OPEN", "SEALED"]);
/** Verifier outcome (WP §6.2). DISPUTED is a first-class result, not a state machine hack. */
export const DecisionResult = z.enum(["VALID", "INVALID", "INSUFFICIENT", "DISPUTED"]);
/** Chain Adapter finality vocabulary (§10.3); schema-level only, no settlement logic in S0. */
export const Finality = z.enum(["FINAL", "PENDING", "REORGED", "UNKNOWN"]);
//# sourceMappingURL=states.js.map