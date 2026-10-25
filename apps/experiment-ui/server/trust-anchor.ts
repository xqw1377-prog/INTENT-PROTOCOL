/**
 * FRONTEND-R1 (HOLD-6 / D6) — the EXPERIMENT-001 external trust anchor.
 *
 * REVISION 2 (AMENDMENT-2 / SECURITY-R1): container isolation verifier.
 * Values frozen in docs/experiments/EXPERIMENT-001.md. The content hashes
 * are the authority; main_sha is the release BASE (parent of the release
 * commit — a commit cannot contain its own id). Before executing an
 * independent replay, the orchestrator verifies the repository's
 * VERIFIER-RELEASE.json is EXACTLY the anchored release — a locally-swapped
 * verifier must never be trusted implicitly. A test asserts these constants
 * match the anchor document byte-for-byte.
 */
export const TRUST_ANCHOR = {
  main_sha: "be22031cdbd018e4aedc8fb2d25c4f244b00173f",
  implementation_audit_sha: "PENDING-COMMANDER-AUDIT-SECURITY-R1",
  verifier_release_sha256: "sha256:f24d83d03c929c40086b04f768e494a5d68e1494b571968324404886cee143bd",
  portable_replay_sha256: "sha256:5345ed1e9d269c9b3e6270a030a78f6e74457f37287dffd6acdbcb12789ab217",
  runtime_image: "node:22.23.4-bookworm@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384",
} as const;

export const ANCHOR_DOC = "docs/experiments/EXPERIMENT-001.md";
