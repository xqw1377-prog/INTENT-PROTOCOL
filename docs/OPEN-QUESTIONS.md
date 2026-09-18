# OPEN QUESTIONS — P0-S0 Schema Freeze

**Status: ALL CLOSED.** Commander ruled the remaining questions on 2026-09-17 (R14). The S0 semantic surface is now frozen; further changes only via independent conformance findings of concrete contradiction/security defects, or a new `schema_version`.

## Resolution record

| # | Question | Resolution | Enforcement |
|---|----------|------------|-------------|
| OQ-1 | Canonicalization standard | **`IPC-JSON-1`** — protocol's own closed profile, NOT JCS (R13) | `CANONICAL_PROFILE`, ADR-S0-001 |
| OQ-2 | `EvidenceArtifact.content_hash` semantics | `payload_hash` = CAS/raw bytes; `content_hash` = self-digest (approved) | `EvidenceArtifactSchema` |
| OQ-3 | ID uniqueness | `criterion_id`/`constraint_id` unique per Intent; cross-object existence → S1/ledger | `IntentContractSchema.superRefine` |
| OQ-4 | `state` fields in hash preimage | `state` hashed ONLY on `EvidenceBundle`; other objects carry no lifecycle fields | schemas as implemented |
| OQ-5 | SubjectRef grammar | `<kind>:<id>`; kinds {user,org,agent,verifier,arbitrator,service,operator}; `@` allowed | `SubjectRefSchema` |
| OQ-6 | Signature schemes | {ed25519, secp256k1, eip191, eip712, passkey-p256} frozen | `SignatureSchema` |
| OQ-7 | AssetRef format | `{network, asset, decimals}`; CAIP-2-flavored network id | `AssetRefSchema` |
| OQ-8 | Decimal precision | Non-negative canonical form (unique repr) + scale ≤ `asset.decimals` | `DecimalSchema`, R3/R12 |
| OQ-9 | Signature wire-required? | Optional in schema; freeze-time signing is a workflow rule (S1) | schemas as implemented |

## Ruled-by-Commander additions (R1–R13)

See ADR-S0-004 (R1–R8) and ADR-S0-005 (R9–R14): NFC-required keys, canonical decimals, bundle merkle recomputation, settlement single-asset + exact sums, decision binding recomputation incl. milestone_id/bundle_id, seal round-trip idempotence, lowercase UUIDs, surrogate rejection, IPC-JSON-1 naming.

## Deferred to S1 by ruling

- Referential existence of `decision_id`/`bundle_id`/`milestone_id` — ledger concern.
- Full state machines (§7), freeze-time signature enforcement — workflow rules.
