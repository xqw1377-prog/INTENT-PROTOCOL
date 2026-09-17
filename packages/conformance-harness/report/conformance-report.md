# Intent Protocol P0-S0 Conformance Report (Builder B, Independent Verifier)

- Generated: 2026-09-17T15:13:34.045Z
- SUT snapshot: captured 2026-09-17T14:25:58.822Z from git `d2ddb961` (zod 3.25.76)
- Checks: **140 PASS / 5 FAIL / 32 UNKNOWN** (177 total)
- Gate status: **NOT_READY** — no freeze declared; freeze authority: Commander.

## Area rollup

| Area | Verdict | PASS | FAIL | UNKNOWN |
|---|---|---|---|---|
| C-01 | **FAIL** | 9 | 1 | 0 |
| C-02 | **PASS** | 9 | 0 | 0 |
| C-03 | **PASS** | 6 | 0 | 0 |
| C-04 | **PASS** | 10 | 0 | 0 |
| C-05 | **FAIL** | 7 | 1 | 0 |
| C-06 | **PASS** | 5 | 0 | 0 |
| C-07 | **UNKNOWN** | 3 | 0 | 4 |
| C-08 | **UNKNOWN** | 9 | 0 | 2 |
| C-09 | **UNKNOWN** | 7 | 0 | 2 |
| C-10 | **FAIL** | 7 | 1 | 1 |
| C-11 | **UNKNOWN** | 6 | 0 | 2 |
| C-12 | **UNKNOWN** | 5 | 0 | 2 |
| C-13 | **FAIL** | 48 | 2 | 3 |
| C-14 | **UNKNOWN** | 2 | 0 | 9 |
| C-15 | **UNKNOWN** | 3 | 0 | 6 |
| SUT-LOAD | **UNKNOWN** | 4 | 0 | 1 |

## FAIL findings

### C-01-07 — [C-01-07] FAIL: spec rule 4 says -0 is rejected; the SUT accepts it and silently maps it to 0 (0/-0 hash ambiguity)
- Evidence: `packages/conformance-harness/test/01-canonical-determinism.test.ts`
- Message: `AssertionError: expected [Function] to throw an error`
- Reproduce: `npx vitest run packages/conformance-harness/test/01-canonical-determinism.test.ts -t "C-01-07"`

### C-05-05 — [C-05-05] an object holding BOTH the NFC and NFD spelling of one key must not produce ambiguous canonical JSON
- Evidence: `packages/conformance-harness/test/05-unicode-normalization.test.ts`
- Message: `AssertionError: canonical text has duplicate keys: {"é":2,"é":1}: expected 1 to be 2 // Object.is equality`
- Reproduce: `npx vitest run packages/conformance-harness/test/05-unicode-normalization.test.ts -t "C-05-05"`

### C-10-03 — [C-10-03] FAIL: schema admits thresholds that canonicalization rejects (2^53 is integer but not safe) — schema-valid object cannot be sealed
- Evidence: `packages/conformance-harness/test/10-criterion-mutation.test.ts`
- Message: `AssertionError: expected [Function] to not throw an error but 'CanonicalizationError: number must be…' was thrown`
- Reproduce: `npx vitest run packages/conformance-harness/test/10-criterion-mutation.test.ts -t "C-10-03"`

### C-13-05 — [C-13-05] FAIL: Timestamp regex accepts calendrically impossible RFC 3339 strings (month 13, day 45, hour 99)
- Evidence: `packages/conformance-harness/test/13-malformed-references.test.ts`
- Message: `AssertionError: 2026-13-01T00:00:00.000Z: expected [Function] to throw an error`
- Reproduce: `npx vitest run packages/conformance-harness/test/13-malformed-references.test.ts -t "C-13-05"`

### C-13-07b — [C-13-07b] FAIL: U64-as-string regex has no upper bound — 2^64 is accepted by the schema but rejected by u64be() at hashing time
- Evidence: `packages/conformance-harness/test/13-malformed-references.test.ts`
- Message: `AssertionError: expected [Function] to throw an error`
- Reproduce: `npx vitest run packages/conformance-harness/test/13-malformed-references.test.ts -t "C-13-07b"`

## Freeze blockers (Commander-ruled: must be dispositioned before G1)

- **C-07-01**: Commander ruling 2026-09-17 (Issue #1 disposition): must be decided before G1 Freeze; cannot be deferred to a later layer. Question: must criterion_id be unique within success_criteria?
- **C-07-02**: Commander ruling 2026-09-17 (Issue #1 disposition): must be decided before G1 Freeze; cannot be deferred to a later layer. Question: must constraint_id be unique within constraints?
- **C-11-05**: Commander ruling 2026-09-17 (Issue #1 disposition): must be decided before G1 Freeze; cannot be deferred to a later layer. Question: which layer owns the total_amount == sum(outputs.amount) invariant (schema, policy, or settlement engine)?
- **C-11-06**: Commander ruling 2026-09-17 (Issue #1 disposition): must be decided before G1 Freeze; cannot be deferred to a later layer. Question: what IS the canonical decimal form (and how are '-0'/'0.00'/'1.10' normalized)?
- **C-14-02**: Commander ruling 2026-09-17 (Issue #1 disposition): must be decided before G1 Freeze; cannot be deferred to a later layer. Question: which layer owns Decision/Settlement cross-object binding (schema-time, verification-engine, or ledger)?
- **C-14-03**: Commander ruling 2026-09-17 (Issue #1 disposition): must be decided before G1 Freeze; cannot be deferred to a later layer. Question: which layer owns Decision/Settlement cross-object binding (schema-time, verification-engine, or ledger)?
- **C-14-04**: Commander ruling 2026-09-17 (Issue #1 disposition): must be decided before G1 Freeze; cannot be deferred to a later layer. Question: which layer owns Decision/Settlement cross-object binding (schema-time, verification-engine, or ledger)?
- **C-15-04**: Commander ruling 2026-09-17 (Issue #1 disposition): must be decided before G1 Freeze; cannot be deferred to a later layer. Question: must a SEALED bundle's merkle_root be verified against artifact_hashes at seal time?

## UNKNOWN (never auto-PASS)

- **PKG-ENTRY-01** (blocked): blocked: Live package barrel/@intent/protocol-schema entry import was not evaluated against the frozen snapshot: Builder A edited the live tree twice during verification (missing events.js -> fixed; Milestone/Plan/Run/Grant/Edge/Dispute objects removed; artifact content_hash renamed payload_hash; SubjectRef charset widened). Re-run scripts/capture-sut.mjs to pin a newer SUT.
- **C-07-01** (gap_documented): gap_documented: No uniqueness constraint on criterion_id: two same-id criteria with different assertions are both schema-valid and mutually ambiguous for any verifier resolving criteria by id.
- **C-07-02** (gap_documented): gap_documented: No uniqueness constraint on constraint_id.
- **C-07-04** (gap_documented): gap_documented: Duplicate artifact hashes/run ids accepted while a bundle is OPEN; the delivered superRefine only guards SEALED.
- **C-07-07** (gap_documented): gap_documented: Duplicate keys in raw JSON text collapse last-wins at JS parse time before canonicalization; two byte-different evidence texts can share one hash.
- **C-08-05** (gap_documented): gap_documented: Criterion.threshold is open-ended JSON by design; arbitrary nested semantics are representable inside a frozen criterion.
- **C-08-06** (blocked): blocked: Unknown-field strictness for Milestone/Plan/ExecutionRun/CapabilityGrant/ContributionEdge/DisputeCase cannot be tested: objects documented in arch doc §6 are absent from the delivered S0 snapshot.
- **C-09-08** (gap_documented): gap_documented: EvidenceArtifact carries no self content_hash field; a received artifact cannot prove its own metadata integrity the way a sealed Intent can (payload_hash covers CAS bytes only).
- **C-09-09** (gap_documented): gap_documented: payload_hash is format-checked only; the (bytes, hash) binding is enforced by CAS-side recomputation outside the delivered layer.
- **C-10-08** (blocked): blocked: Milestone acceptance-criteria immutability cannot be tested: Milestone object absent from the delivered S0 snapshot.
- **C-11-05** (gap_documented): gap_documented: Economic invariant total_amount == sum(outputs.amount) is not enforced anywhere in the delivered layer.
- **C-11-06** (gap_documented): gap_documented: No canonical decimal form: '-0', '0.00', '1.10' are all accepted; the same economic value has multiple hashes across implementations.
- **C-12-06** (gap_documented): gap_documented: A decision may reference an OPEN (unsealed) bundle; nothing in the delivered layer binds decision validity to bundle state.
- **C-12-07** (gap_documented): gap_documented: Same bundle_id with a different artifact set is representable; no uniqueness/append-only constraint exists in the schema layer.
- **C-13-02c** (gap_documented): gap_documented: SubjectRef id charset was widened to include '@' during verification; lookalike principal ids (alice@evil) are now valid.
- **C-13-09b** (gap_documented): gap_documented: UUID schema accepts any RFC version and uppercase; intent ids are not pinned to a single version/canonical form.
- **C-13-12** (blocked): blocked: Run manifest / grant / edge NodeRef / dispute reference validation cannot be tested: objects absent from the delivered S0 snapshot.
- **C-14-02** (gap_documented): gap_documented: decision.intent_hash can be fabricated; no delivered API binds a decision to an existing Intent object.
- **C-14-03** (gap_documented): gap_documented: decision.evidence_root need not equal merkleRoot(bundle.artifact_hashes); the contradiction is representable.
- **C-14-04** (gap_documented): gap_documented: Settlement may reference a dangling decision_id and arbitrary proof_binding.
- **C-14-05** (gap_documented): gap_documented: decision.milestone_id / bundle.milestone_id can dangle; no Milestone object is delivered at all.
- **C-14-06** (gap_documented): gap_documented: bundle.run_ids can reference nonexistent runs.
- **C-14-08** (gap_documented): gap_documented: verification/settlement policy refs are content-addressed but no policy object schema ships to bind them.
- **C-14-09** (blocked): blocked: ContributionEdge.evidence_ref existence unenforceable: Edge object absent from the delivered S0 snapshot.
- **C-14-10** (blocked): blocked: DisputeCase.challenged_decision existence unenforceable: DisputeCase object absent.
- **C-14-11** (blocked): blocked: ExecutionRun.grants existence/scope unenforceable: Run/Grant objects absent.
- **C-15-04** (gap_documented): gap_documented: A SEALED bundle may declare a merkle_root that does not match its artifact_hashes; only external recomputation detects the lie.
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
The spec header claims 'RFC 8785 / JCS compatible', but JCS does NOT normalize strings, while this protocol NFC-normalizes keys and values. A strict JCS implementation produces different canonical bytes (and different hashes) for any string not already in NFC. Additionally, lone surrogates and U+2028/2029 pass through as JSON-legal but JS-source-illegal text — a hazard for eval-adjacent consumers and some non-JS JSON libraries.
- Grounded by: C-05-01, C-05-06, C-05-07

### AS-12 [high] Delivered scope is a moving subset of the documented protocol
Arch doc §6/§7 document 10+ object kinds and 6 state machines; the delivered snapshot contains 6 object kinds, a 2-state bundle lifecycle, and no transition engine, and it changed shape twice while this verification was running (events.js removed; Milestone/Plan/Run/Grant/Edge/Dispute dropped; content_hash renamed payload_hash; SubjectRef charset widened). Until Builder A declares a frozen revision, any conformance verdict is point-in-time only — which is why this harness pins a snapshot.
- Grounded by: C-08-06, C-13-12, C-14-09, C-15-05, C-15-06, C-15-07, C-15-08, C-15-09, PKG-ENTRY-01

### AS-13 [low] SubjectRef charset widened to include '@' without protocol review
user:alice@evil is now a valid principal. Visual spoofing of email-like principal ids becomes representable in signed objects.
- Grounded by: C-13-02c

### AS-14 [medium] Economic invariants absent from every delivered layer
total_amount != sum(outputs) parses; outputs are not bounded by any escrow notion; u64 nonce has no monotonicity. The A5/A7 principles (proof before payment, idempotent effects) currently rest entirely on undelivered engines.
- Grounded by: C-11-05, C-11-07

## Statement

This report is a point-in-time, black-box conformance verdict against the frozen SUT snapshot recorded above. It does not certify the protocol, does not declare any schema frozen, and does not reuse Builder A code as verification logic. UNKNOWN entries stay UNKNOWN until the enforcing layer is delivered and re-verified.
