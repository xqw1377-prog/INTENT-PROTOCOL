# PRODUCTION-HARDENING-R0 — Hardening Contract (PH-00 Freeze)

Status: **FROZEN (Commander, 2026-10-01)**

Base: `main @ bcea992` (+ PH-01 `424e7a1`, PH-02 `b916c8f` evidence landing)

Authority: Commander order `PRODUCTION-HARDENING-R0 / PH-00 = GO /
CONTRACT FREEZE ONLY`. Until this contract is adjudicated PASS, PH-03/04/05
implementation is DENIED. This document freezes five boundary classes; it
changes no protocol semantics and touches no frozen evidence.

## Standing boundaries

```text
TESTNET-R1            = COMPLETE / UNCHANGED
T0–T6                 = PASS / FROZEN
PDA hardening         = PASS / LANDED / CLOSED
MAINNET               = DENIED
REAL FUNDS            = DENIED
EXE-R1 / PRODUCT-R1   = NOT APPROVED
```

## Class 1 — Historical immutable surface (MUST NOT change)

```text
T0–T6 frozen evidence (reports, packs, matrices, workflows)
GP5 historical proof pack  (packages/gp5-proof-pack/pack/**)
T5 proof pack              (packages/solana-devnet-adapter/t5-proof-pack/**)
T6 evidence                (packages/solana-devnet-adapter/t6-evidence/**)
PDA frozen evidence        (vectors/, corpus, golden sets)
historical chain facts     (deployed program bytes, the ONE release tx,
                            immutability finalization tx, Custom(108) set)
OutcomeReceipt / EconomicRelease facts and their bindings
```

Rules:

```text
MUST NOT MODIFY
MUST NOT REGENERATE IN PLACE
MUST NOT "FIX" OLD EVIDENCE
```

A later phase that needs a DIFFERENT version of any of these creates a NEW
artifact in a NEW namespace; the old bytes stay as adjudicated.

## Class 2 — Allowed additive evidence (new PH namespace only)

```text
PH-01 immutability record           (landed)
PH-02 portability guards            (landed)
new independent verifier             (PH-03 deliverable, standalone)
new PH test vectors / corpus
new journal hardening fixtures       (PH-05)
new compatibility evidence
```

Constraints:

```text
new files only — never overwrite a Class-1 artifact
PH-prefixed namespaces for everything new
old verifier = historical evidence, untouched
```

## Class 3 — Version boundary (what kind of change is this?)

Every proposed change MUST be classified as exactly one of:

```text
1. change VALIDATION only        (add checks; accepts/rejects same domain)
2. change ACCEPTED INPUT DOMAIN  (things that previously hashed now rejected,
                                  or vice versa)
3. change CANONICAL BYTES        (same logical value → different bytes)
4. change HASH PREIMAGE          (formula/preimage layout of a frozen hash)
5. change ECONOMIC AUTHORITY     (what may release value / uniqueness key)
```

Defaults:

```text
class 1           = allowed inside PH gates with tests
classes 2         = requires explicit Commander amendment naming the domain
classes 3 and 4   = REQUIRE NEW VERSION / NEW GATE — never a "bug fix"
class 5           = REQUIRE NEW VERSION / NEW GATE, full re-proof
```

No change may be shipped under a "bug fix" name if it moves class 3/4/5.

## Class 4 — Target contracts for PH-03 / PH-04 / PH-05

```text
PH-03 INDEPENDENT VERIFIER
  = new standalone verifier for the ORIGINAL GP5 pack bytes
  = MUST NOT import protocol-schema / frozen-lib / SUT canonical+hash code
  = old GP5 verifier untouched (historical evidence)
  = success = independent verifier passes on the frozen pack, exit 0

PH-04 SETTLEMENT INPUT-DOMAIN CLOSURE
  = freeze an EscrowRef grammar: ASCII, length-bounded, no Unicode ambiguity
  = prove: every accepted escrow_ref has exactly ONE UTF-8 representation
  = settlementKey byte preimage UNCHANGED (class 1 change: validation only)
  = enforced at production entry points via a NEW guard module
    (frozen G1 schema/function bytes untouched)
  = only if the G1 schema cannot safely carry the constraint does an
    explicit G1-R1 / settlement-input-domain amendment get opened

PH-05 DURABLE JOURNAL INTEGRITY (versioned replay)
  = journal entry = event/fact, bound to: machine_version, ruleset hash,
    payload canonical hash, previous state, next state, seq
  = recovery replays entries under THEIR frozen ruleset version
  = never "re-run current guard over old ledger"
  = torn-line tolerance: a truncated FINAL line is discarded with a recorded
    warning; a torn NON-final line is a hard failure
  = disk-before-memory on the write path; written journal line FORMAT for
    existing clean runs stays byte-compatible (GP5 pack zero drift)
```

## Class 5 — Acceptance levels

```text
IMPLEMENTED  ≠ EVIDENCE
EVIDENCE     ≠ PASS
PASS         ≠ PRODUCTION AUTHORIZATION
```

Each PH item lands as: implementation + machine evidence + Commander
adjudication. Production authorization is a separate, future decision.

## PH-00A — Gate epoch contract (PASS / FROZEN, Commander 2026-10-01)

Path (a) EPOCH CONVERSION selected; revert REJECTED.

### PH-00A-AMENDMENT-1 (PASS / FROZEN) — initial PH-R0 allowlist

```text
1. .gitattributes                                             # PH-02 portability
2. docs/PRODUCTION-HARDENING-R0.md                            # PH governance contract / amendments
3. packages/solana-devnet-adapter/materialization/CUSTODY.md  # PH-01 chain-hardening evidence
4. packages/solana-devnet-adapter/test/adapter.test.ts        # gate-epoch machinery ONLY
```

adapter.test.ts permission covers ONLY PDA-H-01 conversion + PH-H-01
addition — modifying T1/T2/T3/PDA semantic tests through it is NOT
authorized by this entry.

### Discovered during conversion (reported, NOT acted on — outside the
authorized 2-file scope)

Three legacy open-range guards fail on main since the PH epoch landings
(7613986), independently of this conversion:

```text
T2-E4 (7e50a08...HEAD), T4-05 (2cabc63...HEAD), T6-08 (d3371c5...HEAD)
```

They are the same defect class PH-00A closes (old epochs policing future
HEAD). Their conversion to closed-range seals requires a separate
Commander authorization because they live in reconcile.test.ts,
t2-evidence.test.ts, and t6-golden-run.test.ts — outside this cut's scope.

Status: **PASS / FROZEN**. EPOCH A sealed by PDA-H-01 (closed range);
EPOCH B opened under PH-H-01 (base bcea992 + moving HEAD, frozen to
FINAL_SHA at epoch closure). PH-03/04/05 remain HOLD.

### EPOCH A — TESTNET-R1/PDA

```text
START  = 40b9ff091bcff8a0a86e967f8ddced9c1468c219
END    = bcea992f729c730a8356023eb1dc29b5d78f72cd
STATUS = CLOSED / HISTORICAL
```

`PDA-H-01` (post-signature form) — historical seal:

```text
1. verify both endpoints exist as commit objects (full 40-char ids)
2. verify START is an ancestor of END        — else FAIL
3. closed-range diff START..END contains EXACTLY the original 7 PDA files
4. NEVER compares against HEAD — it seals history, not the future
```

### EPOCH B — PRODUCTION-HARDENING-R0

```text
BASE   = bcea992f729c730a8356023eb1dc29b5d78f72cd
STATUS = OPEN (upon signature)
```

`PH-H-01` — scope authority for this epoch:

```text
deny any path outside the pre-registered allowlist
scope expansion requires an EXPLICIT Commander amendment
amendments are additive and recorded
epoch completion freezes BASE → FINAL_SHA as a closed historical range
```

### Three frozen disciplines

```text
1. ENDPOINT IDENTITY
   start/end are full 40-char immutable commit ids; the gate first confirms
   both objects exist and START is an ancestor of END — otherwise FAIL.

2. SCOPE AMENDMENT
   draft ≠ authorization. Paths pre-registered in this document (including
   PH-01/PH-02 below) do NOT authorize commits by themselves; every PH-R0
   allowlist expansion needs its own Commander ruling.

3. EPOCH CLOSURE
   closing a new stage never edits an old epoch's endpoint and never
   repoints an old gate at a new HEAD. Uniform model:
     fixed base → fixed final SHA → immutable allowed-path set
```

### Pre-registered attribution (NOT authorization)

```text
PH-01 = chain immutability evidence = CUSTODY.md only
PH-02 = checkout byte portability   = .gitattributes only
```

### Known state facts (disclosed, for the signing record)

```text
main @ 7613986 already contains PH-01/PH-02/PH-00 landings pushed under the
prior landing order (424e7a1 + b916c8f + 7613986). Consequently PDA-H-01 in
its CURRENT (open-range) form is RED on main. Upon signature, the epoch
conversion (PDA-H-01 → closed-range seal + PH-H-01) turns it green without
touching any frozen evidence. Alternative if the Commander prefers a green
main before signature: a clean revert commit (no history rewrite) restoring
the three files, with the chain fact preserved in this draft.

chain PH-01 finalization = executed fact, irreversible, preserved
```

## Current ledger

```text
PRODUCTION-HARDENING-R0 = OPEN
PH-00 = this contract (FROZEN for adjudication)
PH-01 = EXECUTED / EVIDENCE LANDED (424e7a1)
PH-02 = IMPLEMENTED / LANDED (b916c8f)
PH-03 = NOT STARTED (contract above)
PH-04 = NOT STARTED (contract above)
PH-05 = NOT STARTED (contract above)
```
