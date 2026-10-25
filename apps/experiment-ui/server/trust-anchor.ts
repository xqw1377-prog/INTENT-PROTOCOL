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
  main_sha: "2a4325126fc0e8a5b6816aade8aec9c4f9138a38",
  implementation_audit_sha: "PENDING-COMMANDER-AUDIT-SECURITY-R1",
  verifier_release_sha256: "sha256:001a12012fd93a7e137c283a92d13baf3636496895565d88a69b377c3c4745c2",
  portable_replay_sha256: "sha256:994b058ea1b0e8a3e80b35a1497f4d55c98bfa457fd13b915b61bb6cdeaf5ca2",
  runtime_image: "node:22.23.4-bookworm@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384",
} as const;

export const ANCHOR_DOC = "docs/experiments/EXPERIMENT-001.md";
