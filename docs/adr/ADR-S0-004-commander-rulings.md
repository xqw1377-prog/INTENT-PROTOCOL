# ADR-S0-004 — Commander rulings on freeze blockers (2026-09-17)

- **Status**: RULED (Commander PR #4 review)
- **Scope**: `src/canonical.ts`, `src/primitives.ts`, `src/objects.ts`
- **Implements**: Commander's adjudication of the 8 freeze blockers; all rulings are now enforced at schema level.

## Rulings and enforcement

| # | Ruling | Enforcement |
|---|--------|-------------|
| R1 | Keys are not auto-normalized but **must already be NFC**; otherwise reject. | `canonicalize()` throws on any key `k` where `k.normalize("NFC") !== k` |
| R2 | `criterion_id` and `constraint_id` must be unique within one Intent. | `IntentContractSchema.superRefine` |
| R3 | Decimal is **non-negative canonical form**: `1.10`/`1.0`/`-0`/`00`/`01` illegal; `1.1`/`0.01`/`10`/`0` legal. | `DecimalSchema` regex `^(0|[1-9]\d*)(\.\d*[1-9])?$` |
| R4 | SEALED EvidenceBundle: `merkle_root` must **equal** `merkleRoot(artifact_hashes)` — presence check is not enough. | `EvidenceBundleSchema.superRefine` recomputes |
| R5 | Settlement `total_amount` must equal the **exact** decimal sum of `outputs[].amount`; no floating-point math. | `decimalSum()` (BigInt scaled arithmetic) + superRefine |
| R6 | Decision `proof_binding` must recompute identically from the object's own fields. | `VerificationDecisionSchema.superRefine` recomputes |
| R7 | Referential existence (`decision_id`, `bundle_id`, `milestone_id` pointing at real stored objects) is **out of schema scope** — deferred to S1/ledger. | documented only; no code |
| R8 | `EvidenceArtifact.payload_hash` naming **approved**: CAS/raw-evidence bytes hash = `payload_hash`; object self-digest = `content_hash`. | schema already renamed; OQ-2 closed |

## Consequences

- Golden digests changed vs. `995a161` (Decimal canonicalization altered fixture amounts `"20000.00"` → `"20000"` etc.). This is the intended V1 freeze semantics — the earlier digests are superseded, not drift.
- New negative vectors: `non-nfc-object-key`, `duplicate-criterion-id`, `duplicate-constraint-id`, `non-canonical-decimal`, `settlement-total-mismatch`, `bundle-merkle-mismatch`, `decision-binding-mismatch`.
- New positive vector: `settlement-fractional-decimal` (`0.01 + 0.02 = 0.03`).
