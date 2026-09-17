# Stage Gates

## G0 — Repository Baseline

Purpose: establish a reproducible, governed repository before protocol implementation.

PASS requires:
- Commander contract present
- stage gates present
- isolated Builder A / Builder B branches
- P0-S0 implementation issue
- P0-S0 independent conformance issue
- no product claims beyond actual evidence

## G1 — Schema Freeze

Scope:
- IntentContractV1
- CriterionV1
- EvidenceArtifactV1
- EvidenceBundleV1
- VerificationDecisionV1
- SettlementInstructionV1

PASS requires:
- canonical schemas
- deterministic canonical serialization
- deterministic digest
- versioning contract
- golden valid vectors
- invalid/adversarial vectors
- independent conformance harness
- reproducible reports
- no unresolved semantic ambiguity affecting digest or settlement

## G2 — Intent State Machine

PASS requires deterministic transitions, idempotency, retry/recovery semantics, invalid transition tests, and independent replay.

## G3 — Execution + Proof

PASS requires isolated execution, evidence capture, tamper detection, verifier separation, replay, and explicit UNKNOWN handling.

## G4 — Local Settlement

PASS requires proof-gated local settlement, exact-once/idempotent behavior, recovery after crash, and full reverse traceability.

## G5 — End-to-End Golden Path

PASS requires a complete local flow:
Intent -> Plan -> Execution -> Evidence -> Verification -> Settlement
with a machine-readable evidence bundle and deterministic rerun.

## Testnet / chain gates

No chain integration is authorized before G5. Testnet escrow and a reference chain adapter are subsequent stages. Mainnet remains DENIED until a separately signed gate.
