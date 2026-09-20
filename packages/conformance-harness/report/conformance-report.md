# Intent Protocol P0-S0 Conformance Report (Builder B, Independent Verifier)

- Generated: 2026-09-20T04:46:39.103Z
- SUT snapshot: captured 2026-09-20T04:43:37.971Z from git `dc76ae9e` (zod 3.25.76)
- Checks: **174 PASS / 0 FAIL / 23 UNKNOWN** (197 total)
- Gate status: **READY_WITH_EXCEPTIONS** — NONE — a machine READY status is never an automatic G1 PASS. This report does not declare the schema frozen; freeze authority and the final signature belong to the Commander. 0 FAIL findings, 23 UNKNOWN entries; freeze blockers: 0 OPEN / 20 DISPOSITIONED.

## Area rollup

| Area | Verdict | PASS | FAIL | UNKNOWN |
|---|---|---|---|---|
| C-01 | **PASS** | 9 | 0 | 0 |
| C-02 | **PASS** | 9 | 0 | 0 |
| C-03 | **PASS** | 6 | 0 | 0 |
| C-04 | **PASS** | 10 | 0 | 0 |
| C-05 | **PASS** | 6 | 0 | 0 |
| C-06 | **PASS** | 5 | 0 | 0 |
| C-07 | **UNKNOWN** | 3 | 0 | 2 |
| C-08 | **UNKNOWN** | 9 | 0 | 2 |
| C-09 | **UNKNOWN** | 8 | 0 | 1 |
| C-10 | **UNKNOWN** | 8 | 0 | 1 |
| C-11 | **PASS** | 6 | 0 | 0 |
| C-12 | **UNKNOWN** | 5 | 0 | 2 |
| C-13 | **UNKNOWN** | 50 | 0 | 1 |
| C-14 | **UNKNOWN** | 3 | 0 | 8 |
| C-15 | **UNKNOWN** | 3 | 0 | 5 |
| SPEC-ASSERTIONS | **PASS** | 29 | 0 | 0 |
| SUT-LOAD | **UNKNOWN** | 5 | 0 | 1 |

## FAIL findings

## Freeze blockers (evidence-driven; must be DISPOSITIONED before G1)

- **S-R9** [DISPOSITIONED]: Commander ruling R9 (PROOF TARGET BINDING), 2026-09-17: V1 proof_binding MUST bind at least intent_hash + milestone_id + milestone_revision + evidence_root + policy_hash. A proof must prove the result belongs to THIS specific milestone. Not deferrable to S1. (evidence: S-R9)
- **S-SUBJ** [DISPOSITIONED]: Commander OQ-5 disposition, 2026-09-17/18: remove '@' from SubjectRef id charset in V1. (evidence: S-SUBJ)
- **S-UUID** [DISPOSITIONED]: Commander R-series, 2026-09-18: non-canonical UUID -> FAIL. (evidence: S-UUID)
- **S-RT** [DISPOSITIONED]: Commander R-series, 2026-09-18: sealed round-trip not holding -> FAIL. (evidence: S-RT, S-RT#1, S-RT#2, S-RT#3, S-RT#4)
- **S-ASSET** [DISPOSITIONED]: Commander R-series, 2026-09-18: multiple assets in one Settlement -> FAIL. (evidence: S-ASSET)
- **S-SCALE** [DISPOSITIONED]: Commander R-series, 2026-09-18: amount scale beyond asset.decimals -> FAIL. (evidence: S-SCALE)
- **S-BUDGET** [DISPOSITIONED]: Commander R-series, 2026-09-18: budget cap > total -> FAIL. (evidence: S-BUDGET)
- **S-SURR** [DISPOSITIONED]: Commander R-series, 2026-09-18: lone surrogate entering IPC-JSON-1 -> FAIL. (evidence: S-SURR)
- **S-UNIQ** [DISPOSITIONED]: Commander R-series + PR #3 round 5: ID uniqueness is executable spec; old GAP blocker deduplicated into this assertion. (evidence: S-UNIQ)
- **S-MERKLE** [DISPOSITIONED]: Commander R-series + PR #3 round 5: SEALED merkle enforcement is executable spec. (evidence: S-MERKLE)
- **S-DEC** [DISPOSITIONED]: Commander R-series + PR #3 round 5: canonical decimal is executable spec. (evidence: S-DEC)
- **S-SUM** [DISPOSITIONED]: Commander R-series + PR #3 round 5: settlement sum invariant is executable spec. (evidence: S-SUM)
- **S-KEYNFC** [DISPOSITIONED]: Commander OQ-1 / IPC-JSON-1 freeze, 2026-09-18: canonical profile named IPC-JSON-1; keys must already be NFC. (evidence: S-KEYNFC)
- **S-MS-WIRE** [DISPOSITIONED]: Commander freeze, docs/TRUST-CHAIN.md @ e28a22e (2026-09-18): exact wire contracts are normative for G1; semantic aliases are not conforming; Milestone identity is (intent_hash, milestone_id, milestone_revision). (evidence: S-MS-WIRE-01, S-MS-WIRE-02)
- **S-MS-HASH** [DISPOSITIONED]: Commander freeze, docs/TRUST-CHAIN.md @ e28a22e (2026-09-18): changing any required field changes the object digest. (evidence: S-MS-HASH-01)
- **S-RCPT-WIRE** [DISPOSITIONED]: Commander freeze, docs/TRUST-CHAIN.md @ e28a22e (2026-09-18): receipt wire/hash object and deterministic bindings are frozen in G1; formation logic is S1. (evidence: S-RCPT-WIRE-01)
- **S-RCPT-SET** [DISPOSITIONED]: Commander freeze, docs/TRUST-CHAIN.md @ e28a22e (2026-09-18): duplicates or non-sorted decision_hashes are invalid; the set is the deterministic accepted-decision commitment. (evidence: S-RCPT-SET-01)
- **S-RCPT-HASH** [DISPOSITIONED]: Commander freeze, docs/TRUST-CHAIN.md @ e28a22e (2026-09-18): changing any required field changes the object digest. (evidence: S-RCPT-HASH-01)
- **S-GATE-AUTH** [DISPOSITIONED]: Commander freeze, docs/TRUST-CHAIN.md @ e28a22e (2026-09-18): settlement is authorized only from an accepted OutcomeReceipt; a raw VerificationDecision / proof_binding is never settlement authority. (evidence: S-GATE-AUTH-01, S-GATE-AUTH-02, S-GATE-AUTH-03)
- **S-SETTLEMENT-KEY** [DISPOSITIONED]: Commander freeze, docs/TRUST-CHAIN.md @ e28a22e (2026-09-18): settlement idempotency key binds the receipt, with explicit 0x00 terminator before the fixed-width u64be nonce; same three-way discipline as R9. (evidence: S-SETTLEMENT-KEY-01, S-SETTLEMENT-KEY-02, S-SETTLEMENT-KEY-KAT)

## UNKNOWN (never auto-PASS)

- **PKG-ENTRY-01** (blocked): blocked: Live package barrel/@intent/protocol-schema entry import was not evaluated against the frozen snapshot: Builder A edited the live tree twice during verification (missing events.js -> fixed; Milestone/Plan/Run/Grant/Edge/Dispute objects removed; artifact content_hash renamed payload_hash; SubjectRef charset widened). Re-run scripts/capture-sut.mjs to pin a newer SUT.
- **C-07-04** (gap_documented): gap_documented: Duplicate artifact hashes/run ids accepted while a bundle is OPEN; the delivered superRefine only guards SEALED.
- **C-07-07** (gap_documented): gap_documented: Duplicate keys in raw JSON text collapse last-wins at JS parse time before canonicalization; two byte-different evidence texts can share one hash.
- **C-08-05** (gap_documented): gap_documented: Criterion.threshold is open-ended JSON by design; arbitrary nested semantics are representable inside a frozen criterion.
- **C-08-06** (blocked): blocked: Unknown-field strictness for Milestone/Plan/ExecutionRun/CapabilityGrant/ContributionEdge/DisputeCase cannot be tested: objects documented in arch doc §6 are absent from the delivered S0 snapshot.
- **C-09-09** (gap_documented): gap_documented: payload_hash is format-checked only; the (bytes, hash) binding is enforced by CAS-side recomputation outside the delivered layer.
- **C-10-08** (blocked): blocked: SUPERSEDED PREMISE (remediation-18, PR #5 review): MilestoneV1 IS delivered on the frozen wire (TRUST-CHAIN.md @ e28a22e) and content immutability is enforced by the digest (every required field incl. criterion_ids feeds content_hash — asserted by S-MS-WIRE / S-MS-HASH). Only the lifecycle MUTATION machinery (revision bump / acceptance transition) remains undelivered; that is S1 scope.
- **C-12-06** (gap_documented): gap_documented: A decision may reference an OPEN (unsealed) bundle; nothing in the delivered layer binds decision validity to bundle state.
- **C-12-07** (gap_documented): gap_documented: Same bundle_id with a different artifact set is representable; no uniqueness/append-only constraint exists in the schema layer.
- **C-13-12** (blocked): blocked: Run manifest / grant / edge NodeRef / dispute reference validation cannot be tested: objects absent from the delivered S0 snapshot.
- **C-14-02** (gap_documented): gap_documented: decision.intent_hash can be fabricated; no delivered API binds a decision to an existing Intent object.
- **C-14-03** (gap_documented): gap_documented: decision.evidence_root need not equal merkleRoot(bundle.artifact_hashes); the contradiction is representable.
- **C-14-05** (gap_documented): gap_documented: decision.milestone_id / bundle.milestone_id can dangle; no schema-layer existence check exists (the Milestone object itself IS delivered on the frozen wire — remediation-18 corrected the stale 'not delivered' premise). Existence enforcement is deferred with the other cross-object referential checks.
- **C-14-06** (gap_documented): gap_documented: bundle.run_ids can reference nonexistent runs.
- **C-14-08** (gap_documented): gap_documented: verification/settlement policy refs are content-addressed but no policy object schema ships to bind them.
- **C-14-09** (blocked): blocked: ContributionEdge.evidence_ref existence unenforceable: Edge object absent from the delivered S0 snapshot.
- **C-14-10** (blocked): blocked: DisputeCase.challenged_decision existence unenforceable: DisputeCase object absent.
- **C-14-11** (blocked): blocked: ExecutionRun.grants existence/scope unenforceable: Run/Grant objects absent.
- **C-15-05** (gap_documented): gap_documented: Delivered EvidenceBundleState has 2 of the 7 states documented in arch doc §7; VERIFYING/VALID/INVALID/INSUFFICIENT/CHALLENGED are absent.
- **C-15-06** (blocked): blocked: Milestone state machine (arch doc §7) not delivered.
- **C-15-07** (blocked): blocked: Settlement state machine (arch doc §7) not delivered; SettlementInstruction has no state field in S0.
- **C-15-08** (blocked): blocked: Intent state machine (arch doc §7) not delivered.
- **C-15-09** (blocked): blocked: G0 gate 'illegal transitions 100% blocked' cannot be evaluated: no state-machine code exists (@intent/intent-core absent).

## Attack surfaces

### AS-01 [high] NFC key-collision produces duplicate-key canonical JSON
canonicalize({NFC 'é': 1, NFD 'e'+U+0301: 2}) emits '{"é":1,"é":2}' — invalid, ambiguous canonical text. A second implementation (or JSON.parse) collapses the keys, so the same canonical bytes can be re-read as a different object than the one that was hashed. The independent reference rejects this case.
- Grounded by: C-05-05

### AS-02 [medium] -0 silently canonicalizes to 0 against the frozen spec text
Spec header rule 4 says -0 is rejected; the implementation maps -0 -> 0. Two distinct JS values share one canonical form; a strict cross-language implementation following the written rule will refuse objects the TS implementation accepts (and hash differently on any value it does emit).
- Grounded by: C-01-07

### AS-03 [high] Schema admits values the canonicalizer rejects (unhashable-but-valid objects)
Criterion.threshold uses z.number().int() (accepts 2^53, 1e308) while canonicalization requires safe integers; U64-as-string regex accepts 2^64 while u64be() throws. A schema-valid Intent/Settlement can exist that can never be sealed — parsers in other languages will disagree about whether the object is acceptable at all.
- Grounded by: C-10-03, C-13-07b

### AS-04 [medium] Timestamp format is shape-checked, not calendrically validated
'2026-13-45T99:99:99.999Z' passes TimestampSchema despite being invalid RFC 3339. Cross-language timestamp parsers (strict RFC 3339) will reject objects the TS layer accepted, splitting the hash universe.
- Grounded by: C-13-05

### AS-05 [medium] No canonical decimal form
Amounts like '1.0' / '1.00' / '1' / '-0' are distinct canonical strings for the same economic value. Any component that normalizes decimals before hashing (or after) will disagree with one that does not. Settlement amounts are the highest-value instance.
- Grounded by: C-11-06

### AS-06 [medium] Duplicate-key raw JSON collapses last-wins before canonicalization
'{"a":1,"a":2}' and '{"a":2}' hash identically. Byte-level audit of evidence text diverges from hash-level identity; a malicious producer can include decoy keys that vanish in the hash.
- Grounded by: C-07-07

### AS-07 [medium] Identifier uniqueness is unenforced (criterion_id, constraint_id, bundle_id reuse)
Same-id different-content criteria are representable; the same bundle_id can seal two different artifact sets. Downstream resolution by id becomes attacker-choosable.
- Grounded by: C-07-01, C-07-02, C-12-07

### AS-08 [high] Cross-object references are free-floating
decisions bind fabricated intent_hash/evidence_root; settlements bind dangling decision_id; bundles bind nonexistent runs. Nothing in the delivered layer enforces the §15.1 north-star chain (Receipt -> Settlement -> Decision -> Bundle -> Run -> Intent). The proof_binding construction is sound, but its INPUTS are unauthenticated at this layer.
- Grounded by: C-14-02, C-14-03, C-14-04, C-14-05, C-14-06, C-12-06

### AS-09 [high] SEALED bundle state does not imply a correct merkle_root
The bundle invariant checks presence, not consistency: a SEALED bundle with a fabricated merkle_root parses. Detection requires every consumer to recompute merkleRoot(artifact_hashes) — cheap, but currently nothing mandates it.
- Grounded by: C-15-04, C-09-02

### AS-10 [low] Domain/version separation relies on 0x00 exclusion, not length prefixing
hash_input = domain||0x00||version||0x00||canonical is injective only because (a) domain/version literals are frozen and 0x00-free and (b) canonical JSON escapes control characters. Any future domain string containing U+0000, or a non-JSON-escaping canonicalizer, breaks the separation. A length-prefixed design would not depend on both invariants.
- Grounded by: C-02-06

### AS-11 [low] Unicode strategy diverges from RFC 8785/JCS while claiming compatibility
RESOLVED IN SPEC: the canonical profile is now formally named IPC-JSON-1 (OQ-1) and intentionally diverges from raw RFC 8785/JCS: string VALUES are NFC-normalized, KEYS must already be NFC, and lone surrogates are rejected. Residual hazard: this divergence is deliberate, so a strict JCS implementation still produces different bytes — cross-implementation consumers must implement IPC-JSON-1, not JCS. U+2028/U+2029 remain raw (valid JSON, JS-source-illegal).
- Grounded by: C-05-01, C-05-07, S-KEYNFC, S-SURR

### AS-12 [high] Delivered scope is a moving subset of the documented protocol
Arch doc §6/§7 document 10+ object kinds and 6 state machines; the delivered snapshot contains 6 object kinds, a 2-state bundle lifecycle, and no transition engine, and it changed shape twice while this verification was running (events.js removed; Milestone/Plan/Run/Grant/Edge/Dispute dropped; content_hash renamed payload_hash; SubjectRef charset widened). Until Builder A declares a frozen revision, any conformance verdict is point-in-time only — which is why this harness pins a snapshot.
- Grounded by: C-08-06, C-13-12, C-14-09, C-15-05, C-15-06, C-15-07, C-15-08, C-15-09, PKG-ENTRY-01

### AS-13 [low] SubjectRef charset widened to include '@' without protocol review
user:alice@evil is now a valid principal. Visual spoofing of email-like principal ids becomes representable in signed objects.
- Grounded by: C-13-02c

### AS-14 [medium] Economic invariants absent from every delivered layer
total_amount != sum(outputs) parses; outputs are not bounded by any escrow notion; u64 nonce has no monotonicity. The A5/A7 principles (proof before payment, idempotent effects) currently rest entirely on undelivered engines.
- Grounded by: C-11-05, C-11-07

### AS-15 [high] proof_binding does not bind milestone_id (R9): cross-milestone proof replay
proof_binding = H(intent_hash || milestone_revision || evidence_root || policy_hash) has no milestone_id in the preimage, and the delivered proofBinding() API cannot even receive one. Two distinct milestones sharing revision/intent/policy/evidence-root therefore share a single binding: a VALID decision for milestone A is a structurally valid proof for milestone B. Commander ruling R9 requires binding milestone_id in V1.
- Grounded by: C-12-08

### AS-16 [high] Delivered settlement authorization is decision-gated on the superseded wire
The frozen contract (docs/TRUST-CHAIN.md @ e28a22e) makes Settlement receipt-gated: outcome_receipt_hash required, decision_id/proof_binding forbidden. The delivered SettlementInstructionSchema still REQUIRES decision_id + proof_binding and has no outcome_receipt_hash slot, so the old decision-only authority remains structurally representable — a raw verifier assertion can drive settlement, violating the Proof Before Payment boundary (frozen principle 2).
- Grounded by: S-GATE-AUTH-01, S-GATE-AUTH-02, C-14-04

### AS-17 [high] settlement_key implements the superseded preimage (no domain prefix, proof_binding-keyed)
The frozen idempotency key is SHA256("intent-protocol/v1/settlement-key" || 0x00 || outcome_receipt_hash[32] || UTF8(escrow_ref) || 0x00 || nonce_u64be[8]); the delivered settlementKey computes SHA256(proof_binding[32] || escrow_id || 0x00 || nonce) — no domain separation and keyed on the wrong authority object. Keys derived by the frozen formula and the delivered formula disagree for identical effects, so any cross-implementation idempotency check splits into two incompatible key universes until Builder A lands the frozen derivation.
- Grounded by: S-SETTLEMENT-KEY-02, C-02-09, C-11-07

## Statement

This report is a point-in-time, black-box conformance verdict against the frozen SUT snapshot recorded above. It does not certify the protocol, does not declare any schema frozen, and does not reuse Builder A code as verification logic. UNKNOWN entries stay UNKNOWN until the enforcing layer is delivered and re-verified.
