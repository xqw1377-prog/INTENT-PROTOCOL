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

---

# Golden Path V1 Gates

Normative contract: `docs/GOLDEN-PATH-V1.md`.

These gates are a vertical product slice after G1. They do not reopen or alter G1.

## GP0 — Golden Path Contract Freeze

PASS requires:
- `docs/GOLDEN-PATH-V1.md` exists on the default branch;
- GP-001 is the only authorized demo scenario;
- exact task facts, acceptance criteria, opaque AssetRef, reward, verification policy, and settlement uniqueness model are frozen;
- economic exactly-once release is enforced by unique key `(escrow_ref, outcome_receipt_hash)`;
- `settlement_key` remains instruction-level idempotency only;
- Proof Pack requires full objects + evidence + reproduction script, not hashes alone;
- Builder D independently audits the contract as machine-testable and non-contradictory;
- no G1 wire/hash semantic modification.

## GP1 — G2 Runtime State Machines

PASS requires:
- deterministic legal transitions;
- invalid transitions rejected;
- idempotent retry/replay;
- crash/recovery semantics tested;
- no SEALED EvidenceBundle -> no verification acceptance;
- no policy-satisfied verification -> no OutcomeReceipt;
- no accepted OutcomeReceipt -> settlement cannot become ELIGIBLE;
- independent Builder D replay.

## GP2 — G3 Execution + Evidence

PASS requires:
- isolated Agent execution on frozen GP-001;
- real patch commit from frozen base SHA;
- exact acceptance/build commands reproducible;
- SEALED EvidenceBundle with recomputable merkle_root;
- one-byte evidence tamper causes verification failure;
- independent clean-environment reproduction.

## GP3 — Independent Verification + OutcomeReceipt

PASS requires:
- two distinct verifier identities;
- frozen 2-of-2 acceptance policy;
- each verifier independently recomputes R9 proof_binding;
- both accepted decisions target the same frozen milestone/bundle/policy;
- single-verifier/rejected paths cannot form OutcomeReceipt;
- accepted OutcomeReceipt conforms exactly to frozen G1 wire semantics.

## GP4 — Settlement + Replay Protection

PASS requires:
- OutcomeReceipt-gated local settlement;
- economic release uniqueness on `(escrow_ref, outcome_receipt_hash)`;
- instruction idempotency on `settlement_key`;
- exact instruction replay cannot double release;
- same receipt with a different nonce cannot double release;
- tampered receipt, evidence tamper, wrong target binding, and one-verifier-only paths cannot release;
- crash/retry recovery preserves exactly one economic release;
- complete reverse traceability.

Local GP4 MUST PASS before any authorized devnet adapter exercise. Mainnet remains DENIED.

## GP5 — End-to-End Golden Path

PASS requires a complete GP-001 run through the same runtime success path used outside demo mode:

```
Intent
-> Milestone
-> Agent execution
-> SEALED EvidenceBundle
-> Verifier A ACCEPT
-> Verifier B ACCEPT
-> OutcomeReceipt
-> SettlementInstruction
-> escrow RELEASED exactly once
-> replay / changed-nonce second release blocked
-> self-verifiable Proof Pack
```

Additional PASS requirements:
- no demo/admin verification or release bypass;
- black-box proof that unverified submissions cannot create OutcomeReceipt or RELEASE;
- Proof Pack includes full objects, raw evidence necessary for recomputation, settlement history, and a one-command verifier;
- third-party verification succeeds without trusting Builder C claims.

GP5 is product-closure evidence only. It is not testnet/mainnet/production evidence.

