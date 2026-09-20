# ADR-S0-003 — Schema surface decisions (V0.1)

- **Status**: RULED — with supersessions noted inline (Commander B-rulings, ADR-S0-006)
- **Scope**: `src/objects.ts`, `src/primitives.ts`, `src/states.ts`

## Decisions

1. **Self-digest field**: every hashable object carries optional `content_hash` — including `EvidenceArtifact` and `EvidenceBundle` (Commander B2); `seal()` computes it over `object − {content_hash, signature}` and rejects mismatches. Signatures sign `content_hash`, never raw bytes.
2. **EvidenceArtifact payload renamed** `content_hash → payload_hash`. The doc's §6 field list uses `content_hash` for the *artifact bytes*, colliding with the self-digest convention. Renamed to keep `seal()` uniform — OQ-2 approved (R8).
3. **`SubjectRef` = `<kind>:<id>`** with kinds `user|org|agent|verifier|arbitrator|service|operator`; `@` is **NOT** allowed in id (supersedes the earlier `verifier:x@1` allowance — Commander B3). Product identity ≠ chain address (§13).
4. **Decimals are strings** (`"20000"`), u64 nonces are strings, u32 revisions are integers — no float ever reaches the hash preimage.
5. **Lifecycle fields reduced to minimum**: `EvidenceBundle` keeps only `state ∈ {OPEN, SEALED}` (the only transition whose *data* invariants are frozen: sealed ⇒ ≥1 artifact, unique hashes, `merkle_root`, `sealed_at`). Full state machines (§7) are S1 scope, not S0.
6. **`IntentContract` versioning invariants**: v1 must not carry `parent_hash`; v>1 requires `parent_hash` + `change_reason` (AmendIntent, §7).
7. **Unknown fields rejected** (`.strict()`): a field that would change semantics cannot silently enter the hash preimage.
8. **Criterion hashed inside its parent IntentContract** under `Domain.Intent` — it is not independently anchored at S0.

## Consequences

- Storage-level uniqueness (e.g., two artifacts sharing `artifact_id`) is NOT schema-verifiable — OQ-3.
