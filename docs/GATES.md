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
- MilestoneV1
- EvidenceArtifactV1
- EvidenceBundleV1
- VerificationDecisionV1
- OutcomeReceiptV1
- SettlementInstructionV1

Normative trust chain:

```
Frozen Intent
-> Milestone
-> ExecutionRef
-> EvidenceBundle
-> VerificationDecision
-> OutcomeReceipt
-> SettlementInstruction
```

Rules:
- VerificationDecision is a verifier assertion, not settlement authority.
- OutcomeReceipt is the protocol-recognized accepted outcome after verification-policy satisfaction.
- SettlementInstruction must bind OutcomeReceipt, not a raw VerificationDecision/proof binding.
- Referential existence and policy aggregation execution are S1 ledger/workflow concerns; the S0 wire/hash objects and deterministic bindings are G1 concerns.

PASS requires:
- canonical schemas for all eight trust primitives
- deterministic canonical serialization
- deterministic digest and binding formulas
- versioning contract
- golden valid vectors
- invalid/adversarial vectors
- independent conformance harness covering all eight trust primitives
- reproducible reports
- no unresolved semantic ambiguity affecting digest, outcome acceptance, or settlement
- no direct Decision -> Settlement authorization path in V1

## G2 — Intent State Machine

PASS requires deterministic transitions, idempotency, retry/recovery semantics, invalid transition tests, and independent replay.

## G3 — Execution + Proof

PASS requires isolated execution, evidence capture, tamper detection, verifier separation, policy aggregation into OutcomeReceipt, replay, and explicit UNKNOWN handling.

## G4 — Local Settlement

PASS requires OutcomeReceipt-gated local settlement, exact-once/idempotent behavior, recovery after crash, and full reverse traceability.

## G5 — End-to-End Golden Path

PASS requires a complete local flow:
Intent -> Milestone -> Plan -> Execution -> Evidence -> Verification -> OutcomeReceipt -> Settlement
with a machine-readable evidence bundle and deterministic rerun.

## Testnet / chain gates

No chain integration is authorized before G5. Testnet escrow and a reference chain adapter are subsequent stages. Mainnet remains DENIED until a separately signed gate.
