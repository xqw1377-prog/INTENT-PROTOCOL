# TESTNET-R1 — Solana Devnet Settlement Adapter Contract (T0 Freeze)

Status: **AMENDED per T0-R1 + T0-R2 (Commander, 2026-09-29) — awaiting re-adjudication**

Amendment T0-R1 changes (docs only): (1) gate order frozen as
**T1 → T3 → T2 → T4 → T5 → T6** — devnet materialization (mint/program/
keys/payout binding) is pinned in T3 BEFORE the first settlement/release
transaction; (2) `ClaimantPayoutBindingV1` added — the authoritative
claimant→address binding; (3) `EconomicReleaseDigest` + release-PDA
derivation frozen as an exact byte formula; (4) `ChainReleaseV1` clarified
as adapter-local fact record, NOT a G1 object; (5) Appendix A extended with
the claimant payout slots.

Amendment T0-R2 (docs only) — program-ID materialization vs deployment:

```
Program ID       = pinned BEFORE deployment (T3)
Program deploy   = a later, separately authorized chain action (T2)
program id       ≠ deployment evidence
```

Boundary refined: **before T3 there is NO devnet mutation of any kind;
after T3, program deployment MAY be authorized as a T2 bootstrap action;
before any deployment, the actual PROGRAM_ID is already pinned** (a Solana
program id is determined by its keypair, so it is pinnable pre-deploy).
Accordingly, "T3 before first devnet tx" is tightened everywhere to "T3
before the first settlement/release tx AND before program-deployment
authorization".

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

- pinned at the **T3 devnet materialization freeze**, which PRECEDES every
  devnet mutation (the first post-T3 chain action is at most the
  T2-authorized program deployment; settlement/release txs come only after);
- recorded in this contract's appendix (Appendix A) at pinning time;
- machine-enforced thereafter: any other mint is rejected before tx build;
- **until pinned, the adapter refuses every settlement** — no discovery, no
  default, no env-var override (unpinned → DENY).

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

Nothing else goes on chain. `ChainReleaseV1` is a **TESTNET-R1
adapter-local FACT record, NOT a G1 protocol primitive** — the authority
hierarchy is frozen as:

```
OutcomeReceipt            = the authorization root
EconomicReleaseKey        = the exactly-once authority key
ChainReleaseV1 (on-chain) = FACT, not authority
settlement_key            = instruction idempotency only
```

The existence of an on-chain release account NEVER constitutes payment
authorization by itself.

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
release PDA / account**, derived by an exact byte formula (frozen — a
conceptual `hash(a || b)` is not a cross-implementation contract):

```
EconomicReleaseDigest
= SHA256(
      UTF8("intent-protocol/testnet-r1/economic-release")
      || 0x00
      || UTF8(escrow_ref)
      || 0x00
      || outcome_receipt_hash_raw32        // 32 raw digest bytes; the
   )                                       // "sha256:" prefix and hex
                                           // STRING never participate

release PDA
= findProgramAddress(
      [ UTF8("release"), EconomicReleaseDigest[0..32] ],
      TESTNET_R1_PROGRAM_ID                // program id participates via
   )                                       // PDA semantics by construction
```

Constraints frozen now:

- `nonce`, `settlement_key`, client id, and retry counter **never
  participate** in the digest or the PDA seeds;
- the pair may create the release account exactly ONCE; every later attempt
  (any nonce, any client, any restart) resolves against the same account;
- **T1 must ship JS and Rust golden vectors** for
  `EconomicReleaseDigest` and the release PDA (same input → same digest and
  same PDA in both languages) before any program is written against them.
  The vectors use a **FIXTURE-ONLY program id, explicitly labeled as such**
  — never presented as, nor equal to, the actual deployment program id
  (which is pinned later, at T3).

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
ClaimRecord.claimant
→ frozen ClaimantPayoutBindingV1 (§7.1)
→ recipient token account (ATA)

recipient ATA final balance delta = exactly 10 USDC-test, exactly once
```

measured from pre/post token balances of the BOUND account, not from client
return codes.

## 7. Key custody and operator controls (materialized + hardened in T3, BEFORE T2)

A development wallet private key in `.env` does NOT count as custody.
Under the frozen gate order (T1 → T3 → T2 → T4 → T5 → T6), T3 both
MATERIALIZES the devnet constants (program keypair/pubkey — i.e.
TESTNET_R1_PROGRAM_ID —, mint, keys, payout binding; Appendix A) and
HARDENS them. Program-ID materialization and program deployment are
STRICTLY SEPARATE: the program id is pinnable pre-deploy (it is the program
keypair's pubkey) and MUST be pinned at T3; **no settlement/release
transaction and no program-deployment authorization may exist before T3
materialization is complete** (deployment itself, when it happens, is a T2
bootstrap action under T2 authorization).

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
unbound or substituted
  payout destination      = rejected before tx (§7.1)
```

### 7.1 ClaimantPayoutBindingV1 — the claimant→address authority binding

`ClaimRecord.claimant` (R1 anchor: `agent:gp-001-demo`) is a protocol
identity, NOT a Solana address. A real SPL transfer needs a wallet pubkey /
ATA. The mapping between them is an **authority binding**, frozen as its own
runtime/testnet-only record (NOT a G1 object; GP4/GP5 untouched):

```
ClaimantPayoutBindingV1
  claim_id
  claimant
  network        = solana-devnet
  wallet_pubkey
  token_account  (ATA)
  mint           (the frozen USDC-test mint)
  binding_hash
  bound_at
```

Frozen invariants:

```
ClaimRecord.claimant
→ exactly ONE frozen payout binding
→ exactly ONE Solana destination (wallet_pubkey + token_account)
```

```
caller  cannot override wallet_pubkey
caller  cannot override token_account
adapter cannot discover or choose the recipient dynamically
```

Any settlement whose destination does not resolve through the frozen
binding is rejected BEFORE tx. T2 and T6 PASS criteria are defined through
this binding (§6, §10).

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
  (via the frozen ClaimantPayoutBinding: recipient ATA balance delta
   = exactly 10, exactly once)
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
G-T4  payee == immutable ClaimRecord.claimant via the ONE frozen
      ClaimantPayoutBindingV1 (wallet/ATA); caller/adapter cannot
      substitute the destination
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

All TESTNET-R1 new implementation lives under
`packages/solana-devnet-adapter/**` — including a Solana program, if one is
later authorized, under `packages/solana-devnet-adapter/program/**` (the
program is part of THIS domain; no separate `programs/**` or `contracts/**`
roots are ever opened, to prevent scope drift). Frozen areas receive zero
edits.

ALL TEN PASS is required for `TESTNET-R1 = PASS`. Even then:

```
MAINNET = DENIED
```

## 12. T1–T6 gate matrix (frozen order: T1 → T3 → T2 → T4 → T5 → T6)

| Gate | Deliverable | PASS condition |
|---|---|---|
| T0 | this contract | semantics untouched; minimal chain duties; mainnet hard-denied; fund caps frozen; key roles frozen; failure model frozen — Commander adjudicates |
| T1 | `packages/solana-devnet-adapter/` interface skeleton + deployment boundary | four verbs + full input binding; every mismatch input = DENY BEFORE TX (machine-tested, no chain required); **JS + Rust golden vectors for EconomicReleaseDigest and the release PDA, using a fixture-only program id (labeled; never the actual deployment id)** |
| T3 | devnet materialization freeze + custody/operator hardening | program keypair/pubkey generated and **TESTNET_R1_PROGRAM_ID pinned BEFORE deployment**; USDC-test mint, Deployer/Operator/Treasury, ClaimantPayoutBindingV1, and caps pinned (Appendix A) — before any settlement/release tx AND before deployment authorization; NO payment tx yet; role separation enforced; rotation + unauthorized-key negatives + cap enforcement + mainnet RPC/mainnet-beta/non-frozen-mint machine-rejected |
| T2 | authorized program deployment + on-chain exactly-once | deployment is a T2 bootstrap action under T2 authorization (program id already pinned at T3); then T2-01..08 on devnet; PASS = recipient ATA balance delta exactly 10 once, via the frozen payout binding |
| T4 | failure recovery | UNKNOWN_CHAIN_STATE never auto-fails; crash/timeout/restart reconcile to on-chain truth; zero double releases |
| T5 | `testnet-proof-pack/` + third-party verifier | pack-only reverse trace answers all three questions; independent verify = exit 0 |
| T6 | devnet golden run | full §10 sequence once, no second payment, pack verifies |

## 13. Non-goals

```
no on-chain Intent/Evidence/verification logic
no protocol semantic changes (wire, hash, digest, state machines)
no new G1 objects

ChainReleaseV1
= TESTNET-R1 adapter-local fact record
= NOT a G1 protocol primitive
(the same holds for ClaimantPayoutBindingV1 — a runtime/testnet-only
binding, never a G1 object)

no token, no mainnet, no real funds
no modification of GP4/GP5 frozen surfaces
```

## Appendix A — Frozen pinning records (materialized at T3 — BEFORE any settlement/release transaction AND before program-deployment authorization)

```
USDC-test mint pubkey      = <PINNED AT T3 — adapter refuses all tx until set>
devnet program id          = <PROGRAM PUBKEY PINNED AT T3, BEFORE DEPLOYMENT
                             (pinnable pre-deploy: a Solana program id is its
                             keypair's pubkey; deployment itself is a later,
                             T2-authorized chain action)>
Deployer pubkey            = <PINNED AT T3>
Operator pubkey            = <PINNED AT T3>
Treasury pubkey            = <PINNED AT T3>
claimant wallet pubkey     = <PINNED AT T3 (ClaimantPayoutBindingV1)>
claimant token account     = <PINNED AT T3 (ClaimantPayoutBindingV1, ATA)>
ClaimantPayoutBindingV1
  binding_hash             = <PINNED AT T3>
cap enforcement anchor     = per §7 caps, hard-coded, machine-tested
```

Pinning authority: Commander. Until every slot above is pinned, the adapter
refuses every settlement (no discovery, no default, no env override).
