# OPEN QUESTIONS — P0-S0 Schema Freeze

Status tracking for spec ambiguities. **Correction (Commander, 2026-09-17)**: the previous claim that "none block S0" was wrong — several of these were freeze blockers and have since been RULED. Items marked **RULED** are enforced in code; items still **OPEN** await Commander ruling and must be resolved before G1 can be signed.

## RULED (enforced, ADR-S0-004)

| # | Question | Ruling | Enforcement |
|---|----------|--------|-------------|
| OQ-2 | `EvidenceArtifact.content_hash` — payload hash or self-digest? | **Approved rename**: `payload_hash` = CAS/raw bytes hash; `content_hash` = object self-digest | `EvidenceArtifactSchema` |
| OQ-3 | ID uniqueness inside objects | `criterion_id`/`constraint_id` unique within an Intent; cross-object existence deferred to S1/ledger | `IntentContractSchema.superRefine` |
| OQ-8 | Decimal precision/representation | Non-negative **canonical** decimals only: `1.1`/`0.01`/`10`/`0` legal; `1.10`/`1.0`/`-0`/`00`/`01` illegal | `DecimalSchema` regex |
| (new) | Key normalization policy | Keys must already be NFC — reject non-NFC keys; values NFC-normalized | `canonicalize()` |
| (new) | SEALED bundle integrity | `merkle_root` must equal recomputed `merkleRoot(artifact_hashes)` | `EvidenceBundleSchema.superRefine` |
| (new) | Settlement arithmetic | `total_amount` must equal exact decimal sum of outputs; BigInt math, no floats | `decimalSum()` + superRefine |
| (new) | Decision binding integrity | `proof_binding` must recompute identically from object fields | `VerificationDecisionSchema.superRefine` |

## OPEN (awaiting Commander ruling)

| # | Question | Spec ambiguity | Builder A's provisional resolution | Impact if reversed |
|---|----------|----------------|------------------------------------|--------------------|
| OQ-1 | Which canonicalization standard does §6.1 intend? | Doc mandates fixed ordering/format/normalization without naming a standard | JCS/RFC 8785 minus floats, plus NFC-required keys and integer-only numbers — now diverges enough that it is its own named profile ("IPC-JSON-1"?) | Naming/spec reference only; rules already frozen by ruling |
| OQ-4 | Are `state`/`status` fields part of the hash preimage for the six objects? | §6 field lists omit state for most objects; §7 state machines would mutate hashed objects if `state` were inside | `state` included ONLY on EvidenceBundle (OPEN/SEALED drives data invariants); other objects hash without lifecycle fields | Field set changes → new vectors |
| OQ-5 | SubjectRef grammar | §13 defines identity categories but no wire format | `<kind>:<id>` with kinds {user,org,agent,verifier,arbitrator,service,operator}; `@` allowed (`verifier:x@1`) | Regex change → new vectors |
| OQ-6 | Signature scheme registry | Spec requires signatures but defines no scheme registry | Provisional enum {ed25519, secp256k1, eip191, eip712, passkey-p256} | Enum membership change → new version |
| OQ-7 | AssetRef format | `AssetRef` referenced but format undefined | `{network:"evm:8453"|"fiat:USD"|"sim:local", asset, decimals}` — CAIP-2-flavored network id | Ref change → new version |
| OQ-9 | Should `signature`/`change_reason` be mandatory at freeze time rather than optional in schema? | §7 FreezeIntent implies signing is a workflow step; schema allows unsigned objects | Schema permits unsigned (draft transport); freeze-time signing is a workflow rule, S1 | If schema-encoded: add FROZEN variant type |

## Deferred to S1 by ruling

- Referential existence of `decision_id`/`bundle_id`/`milestone_id` (schema cannot prove a stored object exists) — ledger concern, R7.
- Full state machines for all six objects (§7) — S1 scope.
