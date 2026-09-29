# EXE-R0 — Execution Evidence Extension Freeze

Status: **AMENDED per R0.1 (Commander, 2026-09-29) — awaiting re-adjudication**

Amendment R0.1 changes (docs only): (1) the incorrect "open artifact key"
claim removed — `ExecutionRecordV1` enters as the RAW PAYLOAD of an ordinary
`EvidenceArtifactV1` with `kind: "execution-lineage"`, reusing
`payload_hash` + `EvidenceBundle.artifact_hashes` verbatim; (2) `event_hash`
frozen via the existing `hashObject(Domain.Event, "execution-event.v1", …)`
framing — no parallel SHA256(canonical-json) formula; (3) signature wording
precision — SignatureSchema GRAMMAR only, capture-key trust root deferred to
EXE-R1+; (4) adapter hard constraint — normalize MUST NOT synthesize missing
lineage.

Base: `main @ 667d0f3` (TESTNET-R1/T0 contract head)
Authority: Commander directive (2026-09-29): insert EXE-R0 before TESTNET-R1
continues. Sequencing: `EXE-R0 → TESTNET-R1 → devnet settlement`.

## 0. Standing boundaries

```
NO G1 CHANGE          frozen wire/hash/schema objects byte-unchanged
NO GP4/GP5 CHANGE     frozen settlement surfaces byte-unchanged
NO Salmon dependency  no import, no protocol coupling, no vendor lock
NO new settlement logic
NO runtime rewrites   existing GP2 runner / runtime journal untouched here
```

This layer is an **evidence INPUT extension**. It strengthens what enters
the EvidenceBundle; it changes nothing about what leaves it
(VerificationDecision / OutcomeReceipt / Settlement semantics are frozen).

## 1. Position in the stack

```
                ┌────────────────────┐
                │ Human / Machine    │
                │ Intent             │
                └─────────┬──────────┘
                          ▼
                Intent / Milestone          (frozen, off-chain)
                          ▼
                 Execution Runtime          (existing)
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
Native Capture                    External Evidence Providers
ExecutionEventV1                  Salmon / CI / Cloud / MCP / ...
StateLineage                                │
         │                                   │
         └──────────────┬────────────────────┘
                        ▼
             ExecutionEvidenceAdapter       (this contract)
                        ▼
                 EvidenceBundle             (frozen G1, open artifact keys)
                        ▼
             Independent Verifiers          (frozen)
                        ▼
                 OutcomeReceipt             (frozen)
                        ▼
                  Settlement                (frozen)
```

Competitive framing (recorded, not normative): external execution-verification
systems (e.g. Salmon EVI) prove **what an agent executed**; INTENT PROTOCOL
proves **whether the intended outcome was achieved — and makes the verified
outcome safely settleable**. This layer lets such systems plug in as upstream
evidence providers instead of being competitors.

## 2. The load-bearing insertion fact

The frozen G1 `EvidenceArtifactV1` carries the payload by hash —
`{ schema_version: "artifact.v1", artifact_id, kind, level, source, subject,
captured_at, payload_hash, locator, privacy_class }` — and `EvidenceBundleV1`
admits artifacts as `artifact_hashes: Hash[]` covered by `merkle_root`.
(NB: the `"key"` strings visible in GP2 reports / Proof Packs are BUILDER
WRAPPER metadata, not G1 wire fields.) Therefore:

```
ExecutionRecordV1 bytes
  → payload of ONE ordinary EvidenceArtifactV1
      { kind: "execution-lineage", payload_hash: hash(record bytes), … }
  → EvidenceBundle.artifact_hashes
  → merkle_root
```

**ZERO G1 CHANGE**: no new wire field, no new object, no schema edit — the
existing `EvidenceArtifactV1` + `payload_hash` + `artifact_hashes` +
`merkle_root` machinery is reused verbatim. Consumers that do not interpret
the `kind` ignore it (forward-compatible).

## 3. ExecutionEventV1 contract

The atomic event primitive. Fields:

```
event_id                 canonical UUID (G1 grammar)
execution_id             binds to the GP2 execution identity
                         (execution_ref / execution_fingerprint)

actor                    who/what performed the action
actor_type               agent | tool | runtime | human | provider

action_type              e.g. command | file-write | api-call |
                         delegation | state-transition
target                   what the action touched

state_before_hash        sha256 commitment to pre-action state
state_after_hash         sha256 commitment to post-action state

predecessor_event_hash   event_hash of the previous event
                         (genesis: "sha256:" + "00"*32)

tool_or_runtime          capturing component identity
timestamp                capture time (logical clock preferred)

capture_boundary         §5 status of THIS event's capture

event_hash               hashObject(Domain.Event, "execution-event.v1",
                         event_body_without_event_hash_and_signature) —
                         REUSING the frozen framing
                         DOMAIN || 0x00 || schema_version || 0x00 ||
                         canonical_json(payload) with the existing
                         Domain.Event = "intent-protocol/v1/event";
                         NO parallel SHA256(canonical-json) formula
signature                capture attestation by the capturing runtime
                         identity — REUSES the frozen SignatureSchema
                         GRAMMAR (scheme/signer/key_id/value) ONLY;
                         the capture-key registry / trust root is an
                         EXE-R1+ concern and is NOT frozen by EXE-R0.
                         An ATTESTATION, never a verification authority
```

Three frozen invariants — the point is these, not the field list:

```
I-1  predecessor linkage    event N+1.predecessor_event_hash
                            == event N.event_hash (or explicit gap, §5)
I-2  state continuity       event N.state_after_hash
                            == event N+1.state_before_hash
                            within a continuous capture scope
I-3  capture attestation    every event is signed by its capturing
                            identity; unattested events are evidence
                            claims, not evidence
```

## 4. ExecutionRecordV1 contract

```
ExecutionRecordV1
  execution_id            the GP2 execution identity
  events[]                ordered, hash-linked ExecutionEventV1 list
  record_head_hash        event_hash of the final event (the record's
                          digest anchor)
  continuity_summary      aggregate of per-event capture_boundary
                          (CONTINUOUS | BROKEN_EXPLICIT)
```

Entry into the protocol:

```
ExecutionRecordV1 bytes → EvidenceArtifactV1
  { kind: "execution-lineage", payload_hash: hash(record bytes), … }
→ EvidenceBundle.artifact_hashes (merkle_root covers it)
```

Binding to the existing trust chain is by `execution_id` — the same identity
the GP2 execution manifest already carries. Nothing else about the bundle,
its seal, or its consumers changes.

## 5. CaptureBoundaryV1 contract (explicit gap honesty)

The most dangerous state is not "there is a gap" but "there is a gap and the
system pretends there is none." Per-event capture status, frozen enum:

```
recorded      captured and attested by a known runtime identity
unsupported   action class the capture layer does not instrument
external      happened outside the capture boundary (e.g. third-party API)
unobserved    capture was down / event missed
unknown       provenance cannot be determined
```

Aggregate continuity rule:

```
continuity = CONTINUOUS       all events recorded, I-1/I-2 hold throughout
          | BROKEN_EXPLICIT   a boundary event exists; gap reason recorded
```

There is NO "CONTINUOUS by assumption". A gap MUST appear as an explicit
boundary/gap record carrying `gap_reason`. This mirrors the protocol-wide
rule: **UNKNOWN never auto-promotes to PASS** — and its evidence-layer form:
**absence of capture is never silently rendered as presence of evidence.**

## 6. ExecutionEvidenceAdapter contract

One interface, many providers:

```
ExecutionEvidenceAdapter
  verifyProviderAttestation(rawProviderEvidence) → ok | reject
      verify provider signatures / credentials FIRST; unverified provider
      material never crosses the boundary
  verifyLineage(record) → ok | reject
      check I-1/I-2/I-3 + capture-boundary consistency
  normalize(rawProviderEvidence) → ExecutionRecordV1
      map provider-native events/artifacts into EXE-R0 objects
```

Frozen provider duties:

```
verify BEFORE map           provider attestation and lineage checks
                            precede any normalization
preserve gaps — HARD       normalize MUST preserve gaps and MUST NOT
                            repair, invent, or synthesize missing events
                            or state continuity; a gap in provider data
                            maps to an explicit boundary record, never to
                            a silently-truncated or back-filled lineage
no authority                the adapter produces EVIDENCE only; it must not
                            alter claimant / amount / receipt / asset, and
                            cannot create VerificationDecisions
idempotent normalization    same provider input → identical record bytes
                            (frozen canonicalize; deterministic ordering)
```

Provider sources (open set): native INTENT capture, Salmon (if/when it
exposes protocol interfaces), GitHub, CI/CD, cloud audit logs, agent
runtimes, container runtimes, browser executors, MCP tool runtimes.

### SalmonAdapter sketch (illustrative, NOT a dependency)

```
Salmon Execution Record
  ↓ verify Salmon signatures
  ↓ verify event lineage (their linkage rules)
  ↓ map selected events/artifacts → ExecutionEventV1 (capture_boundary:
    "external" where INTENT did not itself capture)
  ↓ EvidenceArtifactV1 { kind: "execution-lineage", payload_hash, … }
  ↓ EvidenceBundle → INTENT verifiers → OutcomeReceipt
```

## 7. Verification semantics (unchanged by construction)

```
ExecutionRecordV1
= EVIDENCE

≠ VerificationDecision
≠ OutcomeReceipt
≠ Settlement authority
```

Verifiers MAY consume the lineage as evidence input; the 2-of-2 policy, the
OutcomeReceipt wire, the ClaimRecord binding, and economic exactly-once are
frozen and untouched. A perfectly continuous lineage does NOT auto-produce
an accepted outcome; a broken-explicit lineage does NOT auto-reject one —
verifier policy remains sovereign over interpretation.

## 8. Non-goals

```
no second Salmon         only the minimal primitives (event / boundary /
                         adapter); no product-grade capture instrumentation
no G1 schema edits       no new G1 objects; EXE objects live outside the
                         frozen eight, entering only as ordinary
                         EvidenceArtifactV1 payloads
no new hash primitives   frozen canonicalize, SHA256, the hashObject
                         framing, and Domain.Event are all reused;
                         no parallel formulas
no settlement changes    nothing in this layer speaks to payment
no runtime rewrite       native capture (EXE-R1) upgrades the journal
                         later, under a separate order
```

## 9. Future gate sketch (not authorized by R0)

```
EXE-R1  native capture: signed, hash-linked events from the INTENT
        runtime (journal upgrade path; GP2 flows emit
        "execution-lineage" artifacts)
EXE-R2  adapter conformance harness: provider fixtures, gap-honesty
        matrix, cross-implementation replay
EXE-R3  first external provider adapter (only if a provider exposes a
        stable protocol surface)
```

None of these are authorized until separately ordered.

## 10. Relation to TESTNET-R1

Zero conflict by construction: EXE-R0 touches the evidence INPUT edge;
TESTNET-R1 touches the settlement OUTPUT edge. TESTNET-R1/T0
(`docs/TESTNET-R1.md`, PROPOSED at 667d0f3) continues to await Commander
adjudication; after EXE-R0 adjudication the line resumes at T1 per the
TESTNET-R1 gate matrix.
