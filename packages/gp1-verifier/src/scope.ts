/**
 * GP1 SCOPE SENTINEL (Builder D, Issue #12 §C).
 *
 * Structural pre-check for the GP1 candidate diff. NOT string-scan-only:
 * takes changed paths AND the candidate's public file/export surface; the
 * behavioral half (verification ACCEPT must be rejected without a sealed
 * bundle, etc.) lives in the replay suite itself.
 */

export type ScopeViolationKind =
  | "forbidden-path"
  | "gp2-agent-runner"
  | "gp2-evidence-bundle"
  | "gp3-verifier-decision"
  | "gp3-outcome-receipt"
  | "gp4-release-payment"
  | "gp4-devnet"
  ;

export interface ScopeViolation {
  kind: ScopeViolationKind;
  detail: string;
}

/** Paths the GP1 candidate MUST NOT touch (frozen guardians of earlier gates). */
const FORBIDDEN_PATH_PREFIXES = [
  "packages/protocol-schema/",
  "packages/gp-audit/",
  "packages/gp1-verifier/", // Builder D's oracle is not Builder C's to edit
  "docs/GOLDEN-PATH-V1.md",
  "docs/GATES.md",
];

/**
 * GP2+ implementation signals — matched against FILE PATHS first; the export
 * list is inspected separately (both must be passed by the adapter at replay
 * time; this function does both structural halves).
 * State names like RELEASED in a state machine are NOT violations; these
 * patterns target implementation artifacts of forbidden capabilities.
 */
const GP2_PLUS_FILE_PATTERNS: Array<[ScopeViolationKind, RegExp]> = [
  ["gp2-agent-runner", /agent[-_]runner|tool[-_]execution|agent\/exec/i],
  ["gp2-evidence-bundle", /evidence[-_]bundle(?!-state)|bundle[-_]seal(?!ed-state)|merkle[-_]pack/i],
  ["gp3-verifier-decision", /verifier(?!-state)|verification[-_]decision|decision[-_]engine/i],
  ["gp3-outcome-receipt", /outcome[-_]receipt|receipt[-_]engine|receipt[-_]form/i],
  ["gp4-release-payment", /escrow[-_]release|release[-_]funds|payment|payout|transfer[-_]funds/i],
  ["gp4-devnet", /devnet|solana|usdc/i],
];

const GP2_PLUS_EXPORT_PATTERNS: Array<[ScopeViolationKind, RegExp]> = [
  ["gp2-agent-runner", /runAgent|executeTask|invokeTool/i],
  ["gp2-evidence-bundle", /buildEvidenceBundle|sealBundle|packEvidence/i],
  ["gp3-verifier-decision", /createDecision|signDecision|verifyEvidence/i],
  ["gp3-outcome-receipt", /formReceipt|createOutcomeReceipt|issueReceipt/i],
  ["gp4-release-payment", /releaseEscrow|releaseFunds|payOut|transferFunds/i],
];

export function scopeAudit(
  changedPaths: string[],
  candidateFiles: string[],
  candidateExports: string[],
): ScopeViolation[] {
  const v: ScopeViolation[] = [];
  for (const p of changedPaths) {
    for (const prefix of FORBIDDEN_PATH_PREFIXES) {
      if (p === prefix || p.startsWith(prefix)) v.push({ kind: "forbidden-path", detail: `candidate touches frozen surface: ${p}` });
    }
    for (const [kind, re] of GP2_PLUS_FILE_PATTERNS) {
      if (re.test(p)) v.push({ kind, detail: `candidate adds GP2+ implementation artifact: ${p}` });
    }
  }
  for (const f of candidateFiles) {
    for (const [kind, re] of GP2_PLUS_FILE_PATTERNS) {
      if (re.test(f)) v.push({ kind, detail: `candidate file matches forbidden capability: ${f}` });
    }
  }
  for (const e of candidateExports) {
    for (const [kind, re] of GP2_PLUS_EXPORT_PATTERNS) {
      if (re.test(e)) v.push({ kind, detail: `candidate export matches forbidden capability: ${e}` });
    }
  }
  return v;
}
