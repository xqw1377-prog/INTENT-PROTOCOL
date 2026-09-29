# EXE-R0 — Execution Evidence Extension Freeze

Status: **PROPOSED — awaiting Commander adjudication**

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

The frozen G1 `EvidenceBundleV1` admits artifacts by OPEN key:
`EvidenceArtifactV1 { key, payload_hash, locator }` — proven by GP2's six
artifact keys (`base-acceptance … execution-manifest`). Therefore:

```
ExecutionRecordV1 enters the EvidenceBundle as ONE new artifact key
("execution-lineage") — ZERO G1 wire/hash/schema change.
```

The bundle's merkle_root covers it exactly like every other artifact. No
Proof Pack, verifier, or settlement consumer needs modification to tolerate
it; consumers that do not know the key ignore it (forward-compatible).

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

event_hash               sha256 over the frozen canonical JSON of the
                         event body (all fields above; excludes event_hash
                         and signature) — the G1 content_hash convention,
                         REUSING the frozen canonicalize (no new serializer)
signature                capture attestation by the capturing runtime
                         identity (ed25519, G1 key grammar) — an
                         ATTESTATION, never a verification authority
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
ExecutionRecordV1 bytes → EvidenceArtifactV1 { key: "execution-lineage",
                                               payload_hash, locator }
                       → EvidenceBundle (merkle_root covers it)
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
preserve gaps               gaps in provider data map to explicit boundary
                            records, never to silently-truncated lineages
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
  ↓ EvidenceArtifactV1 { key: "execution-lineage" }
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
                         frozen eight, entering only as bundle artifacts
no new hash formulas     frozen canonicalize reused everywhere
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
