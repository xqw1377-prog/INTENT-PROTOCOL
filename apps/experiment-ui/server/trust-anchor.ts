/**
 * FRONTEND-R1 (HOLD-6 / D6) — the EXPERIMENT-001 external trust anchor.
 *
 * Values frozen in docs/experiments/EXPERIMENT-001.md (revision 8473a7c).
 * Before executing an independent replay, the orchestrator verifies the
 * repository's VERIFIER-RELEASE.json is EXACTLY the anchored release — a
 * locally-swapped verifier must never be trusted implicitly. A test
 * asserts these constants match the anchor document byte-for-byte.
 */
export const TRUST_ANCHOR = {
  main_sha: "fe18be0a5eb9536a7d2e0325352cb6ed0d7bbc90",
  implementation_audit_sha: "ca0c64673a759a713c2cf18813cb22b7fc005741",
  verifier_release_sha256: "sha256:25286e96bd346bd34fa093d40968f690ae357a4d9ece59f9af6c925747cb6027",
  portable_replay_sha256: "sha256:292d580430dbe39c2978060340d2e4d27dd8debcfc807ba5f0a5e6157cbc8493",
} as const;

export const ANCHOR_DOC = "docs/experiments/EXPERIMENT-001.md";
