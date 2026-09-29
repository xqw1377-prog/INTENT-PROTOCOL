# TESTNET-R1 — Solana Devnet Settlement Adapter Contract (T0 Freeze)

Status: **PROPOSED — awaiting Commander T0 adjudication**

Base: `main @ de5ac68c591c7d952c2b143f825f79a81a1369bb`
Authority: Commander order `TESTNET-R1 = GO` (2026-09-29). This document is
the T0 deliverable: contract freeze only. **No code, no program, no RPC, no
devnet transaction, no mainnet** is authorized by T0.

## 0. Standing boundaries

```
GP4 / GP5          = PASS / FROZEN / DO NOT MODIFY
TESTNET            = AUTHORIZED FOR R1 ONLY
MAINNET            = DENIED (hard)
REAL FUNDS         = DENIED (hard)
TOKEN              = NOT-IN-SCOPE
```

## 1. Single objective of TESTNET-R1

TESTNET-R1 does NOT deploy an on-chain Intent Protocol. It proves exactly one
thing:

> The OutcomeReceipt → Settlement semantics already proven by GP4/GP5 keep
> the same payee authorization, economic exactly-once, failure recovery, and
> reverse traceability when settlement lands on Solana Devnet.

```
Local proven semantics (GP4/GP5, FROZEN)
        ↓
Minimal Chain Adapter (new, TESTNET-R1 scope)
        ↓
Solana Devnet
        ↓
same claimant / same amount / same receipt authority
same economic uniqueness / same reverse traceability
```

No protocol element may be re-invented on chain.

## 2. Frozen architecture boundary

The chain is a **Settlement Adapter** only. Everything above the adapter
stays off-chain in the existing frozen runtime:

```
Intent / Milestone
Execution / Evidence
Verification / OutcomeReceipt
ClaimRecord
        │  all off-chain, existing runtime, byte-frozen semantics
        ▼
Settlement Adapter (the ONLY new component)
        ▼
Solana Devnet
```

The chain carries the minimal three duties:

1. accept a settlement authorization already validated by the local protocol;
2. guarantee one economic release can happen only once;
3. leave an on-chain fact reverse-mappable to the `OutcomeReceipt`.

Explicitly forbidden on chain:

```
❌ Intent full text
❌ EvidenceBundle full text
❌ AI reasoning
❌ verifier workflow
❌ Claim workflow
❌ full state machines
❌ user-private data
```

## 3. Frozen constants and authority model

| Constant | Frozen value |
|---|---|
| chain | `solana-devnet` |
| asset | `USDC-test` |
| decimals | `6` |
| escrow_ref (R1 anchor) | `escrow:gp-001-local` |
| authority input | an accepted `OutcomeReceipt` ONLY — never a raw VerificationDecision, never a proof binding |
| payee | `ClaimRecord.claimant` (R1 anchor: `agent:gp-001-demo`), immutable at CLAIM time |
| amount | `"10"` (GP-001 frozen reward) |
| economic uniqueness | `(escrow_ref, outcome_receipt_hash)` — carried over from GP4 verbatim |
| settlement_key | instruction-level idempotency ONLY — never economic authority (GP0 §econ rule carried over) |
| mainnet | hard denied at every layer |

Grounding anchors (already frozen by GP3/GP4/GP5, referenced not redefined):

```
outcome_receipt_hash (R1 anchor)
= sha256:da577b3d04bc53dac6ace4c200679ab36bc1fa21e8be31e2e5c7197cc7706380
task_freeze_hash (GP-001)
= sha256:95ca98eb0146c56be577f9704d8640bb99ef38b5271a94496fc8cc6aa61121e5
claim fixture = packages/gp4-settlement/fixtures/gp-001-claim.json (committed)
```

### 3.1 Mint pinning rule

`USDC-test` must resolve to exactly ONE frozen SPL mint pubkey before any
transaction exists. The mint pubkey is a **required-frozen constant**:

- pinned once at T3 key-custody materialization under Commander authority;
- recorded in this contract's appendix (Appendix A) at pinning time;
- machine-enforced thereafter: any other mint is rejected before tx build;
- **until pinned, the adapter refuses every settlement** (no default, no
  discovery, no env-var override).

## 4. ChainReleaseV1 — the minimal on-chain record

The only on-chain object TESTNET-R1 defines:

```
ChainReleaseV1
  escrow_ref_hash        commitment to escrow_ref
  outcome_receipt_hash   the authority binding (frozen GP4 pair partner)
  claimant               the authorized payee identity
  mint                   frozen USDC-test mint pubkey
  amount                 "10"
  tx_signature           the release transaction signature
  released_at / slot     chain-time fact
```

Nothing else goes on chain. ChainReleaseV1 is a FACT record, not an
authority: the authority remains the accepted OutcomeReceipt off-chain.

## 5. Adapter interface contract (implemented in T1)

New package `packages/solana-devnet-adapter/`. Four verbs, nothing else:

```
prepareSettlement()    bind + verify all inputs against the frozen local ledger
submitSettlement()     submit the authorized release to devnet
observeSettlement()    read chain truth (PDA/account, tx, slot, balances)
reconcileSettlement()  resolve UNKNOWN chain state against on-chain truth
```

Identity of the adapter (frozen):

```
Adapter ≠ settlement authority
Adapter ≠ verifier
Adapter ≠ economic policy
```

The adapter only CONSUMES authorization results GP4 already produced.

`prepareSettlement()` input binding (minimum set):

```
escrow_ref
outcome_receipt_hash
claim_record_hash
claimant
asset (triple)
amount
```

If ANY input disagrees with the frozen local ledger (ClaimRecord claimant,
frozen amount/asset, accepted receipt hash, escrow binding):

```
DENY BEFORE TX
```

Zero-write, zero-tx rejection — the GP4 boundary rule carried to the chain
edge.

## 6. Exact-once mapping (proven in T2)

Economic uniqueness is NOT client-side and NOT `settlement_key`:

```
EconomicReleaseKey = (escrow_ref, outcome_receipt_hash)     [GP4, unchanged]
settlement_key     = instruction idempotency only           [GP0, unchanged]
```

On-chain mapping: the EconomicReleaseKey maps to a **unique deterministic
release PDA / account**:

```
release PDA = hash(escrow_ref || outcome_receipt_hash)
```

Constraints frozen now:

- the PDA is a pure function of the pair ONLY — **no nonce, no client id,
  no retry counter** participates;
- the pair may create the release account exactly ONCE; every later attempt
  (any nonce, any client, any restart) resolves against the same account.

T2 must prove, on devnet:

```
T2-01 normal release
T2-02 exact retry
T2-03 different nonce
T2-04 RPC response lost
T2-05 process crash after submit
T2-06 tx landed but local state unknown
T2-07 duplicate client
T2-08 concurrent clients
```

PASS is NOT "the second transaction errors". PASS is:

```
recipient final balance delta = exactly 10 USDC-test, exactly once
```

measured from pre/post token balances, not from client return codes.

## 7. Key custody and operator controls (proven in T3)

A development wallet private key in `.env` does NOT count as custody.

Three frozen roles:

```
Deployer   devnet program deployment ONLY; cannot authorize settlements
Operator   may request settlements ALREADY authorized by GP4 semantics;
           cannot alter claimant / amount / receipt / asset
Treasury   source of test USDC; balance under hard cap
```

Frozen fund caps (test funds, production discipline):

```
per settlement            = 10 USDC-test
test escrow total balance ≤ 100 USDC-test
max cumulative release
  per test cycle          ≤ 100 USDC-test
```

Hard denials (machine-tested, never README-only):

```
MAINNET RPC endpoints     = rejected
mainnet-beta cluster      = rejected
any non-frozen mint       = rejected
non-frozen asset triple   = rejected
amount ≠ "10"             = rejected
payee ≠ ClaimRecord
  .claimant               = rejected before tx
```

## 8. Chain state and recovery contract (proven in T4)

The real difference from local settlement: **you may not know whether the
transaction succeeded.** Therefore the adapter owns an explicit

```
UNKNOWN_CHAIN_STATE
```

and the rule:

```
RPC error / timeout  → do NOT treat as failure
                    → do NOT re-authorize payment
                    → derive EconomicReleaseKey
                    → inspect release PDA + tx history
                    → reconcile
                    → confirmed release OR safe retry
```

Adapter-side settlement states (adapter-owned ONLY):

```
PREPARED → SUBMITTED → CONFIRMED → FINALIZED
                 ↘ UNKNOWN → RECONCILED
```

These are ADAPTER states. The frozen GP4 state machine
(`LOCKED/ELIGIBLE/RELEASED`) is NOT modified, extended, or re-mapped; the
adapter reconciles INTO it read-only (a chain-confirmed release may mark the
local escrow RELEASED via the existing GP4 engine paths, never around them).

## 9. Cross-layer evidence contract (proven in T5)

Every testnet release must reverse-trace end to end:

```
Solana tx
  ↓
ChainReleaseV1
  ↓
OutcomeReceipt
  ↓
VerificationDecisions (2-of-2)
  ↓
EvidenceBundle
  ↓
Execution
  ↓
ClaimRecord
  ↓
Intent / Milestone
```

Deliverable: `testnet-proof-pack/` containing at minimum:

```
local receipt hash
claim hash
economic release key
tx signature
slot
program/account ids
recipient
mint
amount
pre/post token balance
local settlement evidence
chain observation evidence
```

A third-party verifier must be able to answer, from the pack alone:

```
why did these 10 test USDC go to this address?
which OutcomeReceipt does this payment correspond to?
was it ever paid a second time?
```

## 10. Devnet golden run (T6)

Only after T1–T5 PASS. One complete run:

```
Intent
→ Milestone
→ Claim
→ Agent Execution
→ SEALED Evidence
→ Verifier A VALID
→ Verifier B VALID
→ OutcomeReceipt
→ SettlementInstruction
→ Solana Adapter
→ Devnet Release
→ claimant receives exactly 10 USDC-test
→ replay
→ changed nonce
→ crash/recovery
→ no second payment
→ Testnet Proof Pack
```

This, and only this, may be recorded as `TESTNET-R1 = PASS`.

## 11. Exit criteria (frozen, 10 items)

```
G-T1  GP4/GP5 frozen subtree byte-unchanged
G-T2  mainnet endpoints hard denied (machine-tested)
G-T3  only the frozen devnet asset accepted (machine-tested)
G-T4  payee == immutable ClaimRecord.claimant
G-T5  amount == "10"
G-T6  economic uniqueness survives retry / nonce / concurrency
G-T7  RPC response loss cannot cause double release
G-T8  restart can reconcile on-chain truth
G-T9  third party can reverse-trace tx → OutcomeReceipt → evidence
G-T10 testnet proof pack independently verifies
```

G-T1 protected paths (byte-unchanged through TESTNET-R1):

```
packages/protocol-schema/**
packages/gp4-settlement/src/**
packages/gp5-proof-pack/pack/**
packages/gp3-verification/artifacts/**
packages/golden-path/evidence/9f6610dc-*/**
packages/gp2-verifier/formal/**
```

All TESTNET-R1 code lives under `packages/solana-devnet-adapter/**` and its
tests; frozen areas receive zero edits.

ALL TEN PASS is required for `TESTNET-R1 = PASS`. Even then:

```
MAINNET = DENIED
```

## 12. T1–T6 gate matrix

| Gate | Deliverable | PASS condition |
|---|---|---|
| T0 | this contract | semantics untouched; minimal chain duties; mainnet hard-denied; fund caps frozen; key roles frozen; failure model frozen — Commander adjudicates |
| T1 | `packages/solana-devnet-adapter/` interface skeleton | four verbs + full input binding; every mismatch input = DENY BEFORE TX (machine-tested, no chain required) |
| T2 | on-chain exactly-once | T2-01..08 on devnet; PASS = recipient balance delta exactly 10 once |
| T3 | keys / operator controls / mint pinned (Appendix A) | role separation enforced; caps enforced; mainnet RPC + mainnet-beta + non-frozen mint machine-rejected |
| T4 | failure recovery | UNKNOWN_CHAIN_STATE never auto-fails; crash/timeout/restart reconcile to on-chain truth; zero double releases |
| T5 | `testnet-proof-pack/` + third-party verifier | pack-only reverse trace answers all three questions; independent verify = exit 0 |
| T6 | devnet golden run | full §10 sequence once, no second payment, pack verifies |

## 13. Non-goals

```
no on-chain Intent/Evidence/verification logic
no protocol semantic changes (wire, hash, digest, state machines)
no new G1 objects beyond the fact-record ChainReleaseV1
no token, no mainnet, no real funds
no modification of GP4/GP5 frozen surfaces
```

## Appendix A — Frozen pinning records (filled at T3, Commander authority)

```
USDC-test mint pubkey      = <PINNED AT T3 — adapter refuses all tx until set>
devnet program id          = <PINNED AT T1/T2 DEPLOY>
Deployer pubkey            = <PINNED AT T3>
Operator pubkey            = <PINNED AT T3>
Treasury pubkey            = <PINNED AT T3>
cap enforcement anchor     = per §7 caps, hard-coded, machine-tested
```
