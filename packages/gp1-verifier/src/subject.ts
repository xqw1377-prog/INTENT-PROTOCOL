/**
 * Frozen G1 SubjectRef grammar + GP0 task_freeze_hash shape (Builder D,
 * Issue #12 §B). Self-contained copy from the frozen contracts — deliberately
 * NOT imported from any builder implementation package.
 *
 * SubjectRef (G1 primitives, OQ-5): ^(user|org|agent|verifier|arbitrator|service|operator):[A-Za-z0-9._-]{1,128}$  — no '@'.
 * task_freeze_hash (GP0 §1): "sha256:" + SHA256(exact UTF-8 file bytes) — /^sha256:[0-9a-f]{64}$/.
 */
export const SUBJECT_REF_RE = /^(user|org|agent|verifier|arbitrator|service|operator):[A-Za-z0-9._-]{1,128}$/;
export const TASK_FREEZE_HASH_RE = /^sha256:[0-9a-f]{64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function isSubjectRef(v: unknown): v is string {
  return typeof v === "string" && SUBJECT_REF_RE.test(v);
}

export function isTaskFreezeHash(v: unknown): v is string {
  return typeof v === "string" && TASK_FREEZE_HASH_RE.test(v);
}

export function isCanonicalUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function isRfc3339Utc(v: unknown): v is string {
  return typeof v === "string" && RFC3339_UTC_RE.test(v);
}

/** ClaimRecord (GP0 §3 Claim binding): shape oracle for the immutable record. */
export interface ClaimRecord {
  schema_version: "gp-claim.v1";
  claim_id: string;
  bounty_id: string;
  claimant: string;
  task_freeze_hash: string;
  claimed_at: string;
}

export function claimRecordShapeViolations(c: Partial<ClaimRecord>): string[] {
  const v: string[] = [];
  if (c.schema_version !== "gp-claim.v1") v.push("schema_version");
  if (!isCanonicalUuid(c.claim_id)) v.push("claim_id");
  if (typeof c.bounty_id !== "string" || c.bounty_id.length === 0) v.push("bounty_id");
  if (!isSubjectRef(c.claimant)) v.push("claimant");
  if (!isTaskFreezeHash(c.task_freeze_hash)) v.push("task_freeze_hash");
  if (!isRfc3339Utc(c.claimed_at)) v.push("claimed_at");
  return v;
}
