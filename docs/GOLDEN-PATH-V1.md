# Golden Path V1 — GP0 Frozen Contract

Status: **AMENDED / AWAITING BUILDER D DELTA RE-AUDIT**

Scope: first vertical product proof after G1. This document does not modify any G1 wire/hash semantics.

## 1. Single demo: GP-001 Outcome Bounty

GP-001 proves one complete result transaction:

```
Intent
-> Milestone
-> Agent claim + execution
-> EvidenceBundle
-> 2 independent VerificationDecision objects
-> OutcomeReceipt
-> SettlementInstruction
-> escrow RELEASED
```

The task is a real GitHub code bounty in a demo repository/package. The seeded bug is:

> `retryFetch()` mishandles HTTP 429 `Retry-After` seconds. The Agent must fix the implementation without changing the public API or the frozen acceptance suite.

Required frozen task facts:
- repository URL / package path
- base commit SHA
- issue/task text
- allowed-change path set
- forbidden-change path set
- MilestoneV1
- acceptance criteria
- verification policy
- reward amount
- AssetRef
- escrow_ref
- deadline
- max_attempts = **3**
- frozen acceptance-suite identity

### Task Freeze Record (runtime contract, not a G1 object)

Before GP2 begins, Builder C MUST commit exactly one machine-readable task record at:

`packages/golden-path/fixtures/gp-001-task.json`

Required fields:

```json
{
  "schema_version": "gp-task-freeze.v1",
  "bounty_id": "GP-001",
  "repository_url": "<https-url>",
  "package_path": "<repo-relative-path>",
  "base_commit_sha": "<40-lowercase-hex>",
  "allowed_paths": ["<repo-relative-glob-or-path>"],
  "forbidden_paths": ["<repo-relative-glob-or-path>"],
  "acceptance_suite_path": "<repo-relative-path>",
  "acceptance_suite_sha256": "sha256:<64-lowercase-hex>",
  "max_attempts": 3,
  "deadline": "<RFC3339-UTC>",
  "escrow_ref": "<opaque-nonempty-string>",
  "asset": {
    "network": "solana-devnet",
    "asset": "USDC-test",
    "decimals": 6
  },
  "reward": "10",
  "verification_policy": "2-of-2"
}
```

The record's runtime audit hash is:

```
task_freeze_hash = "sha256:" + SHA256(exact committed UTF-8 file bytes)
```

This is a GP runtime audit hash only. It is NOT a new G1 `content_hash`, schema primitive, or hash domain.

The Task Freeze Record is the single machine-readable source of GP-001 task facts. Intent/Milestone/runtime fields MUST be derived from it and Builder D MUST verify field equality plus `task_freeze_hash` before accepting GP2 evidence. Changing the record after GP2 starts invalidates the run and requires Commander review.

The implementation package created for GP-001 MUST be deterministic and testable without real waiting. The retry sleep path MUST be injectable or fake-timer compatible. The acceptance test MUST observe an exact **2000 ms** requested delay through the injected/fake clock; wall-clock waiting is not evidence.

### Acceptance criteria

At minimum:
1. HTTP 429 + `Retry-After: "2"` causes a 2000 ms retry delay, then retries.
2. A subsequent HTTP 200 is returned to the caller.
3. Retry count obeys the frozen `max_attempts = 3` policy.
4. Non-429 non-success responses do not enter the 429 retry path.
5. Existing package tests pass.
6. Build/typecheck passes.
7. Agent patch changes only allowed implementation paths.
8. The acceptance suite itself is unchanged from the frozen base.

The verifier re-runs the acceptance suite independently. Agent-produced test logs are evidence, not authority.

## 2. Frozen GP-001 asset

The exact V1 AssetRef for GP-001 is:

```json
{
  "network": "solana-devnet",
  "asset": "USDC-test",
  "decimals": 6
}
```

These are opaque, case-sensitive V1 labels under the G1 AssetRef ruling. This contract does not assign CAIP semantics.

Reward amount:

```
10
```

Canonical Decimal rules apply. Scale MUST be <= 6.

GP4 MUST first prove deterministic local settlement using this same opaque asset triple. A Solana devnet adapter may be exercised only after the local GP4 invariant suite passes. Mainnet remains DENIED.

## 3. G2 runtime state machines

Runtime state lives outside the frozen G1 objects.

### Bounty

```
CREATED
-> FUNDED
-> CLAIMED
-> EXECUTING
-> SUBMITTED
-> VERIFIED
-> SETTLED
```

### Claim binding

At the `CLAIMED` transition the runtime MUST append an immutable ClaimRecord:

```json
{
  "schema_version": "gp-claim.v1",
  "claim_id": "<lowercase-hyphenated-uuid>",
  "bounty_id": "GP-001",
  "claimant": "<SubjectRef>",
  "task_freeze_hash": "sha256:<64-lowercase-hex>",
  "claimed_at": "<RFC3339-UTC>"
}
```

`claimant` MUST parse under the frozen G1 SubjectRef grammar. Once appended, the ClaimRecord MUST NOT be mutated or replaced for that bounty execution. ExecutionRef and the Proof Pack MUST reference the same `claim_id`, `claimant`, and `task_freeze_hash`.

### Execution

```
CREATED
-> RUNNING
-> SUBMITTED
-> CLOSED
```

### Verification

```
PENDING
-> ACCEPTED | REJECTED
```

### Settlement

```
LOCKED
-> ELIGIBLE
-> RELEASED
```

Required hard invariants:
- no SEALED EvidenceBundle -> no verification acceptance;
- verification-policy satisfaction is required before OutcomeReceipt formation;
- no accepted OutcomeReceipt -> settlement cannot become ELIGIBLE;
- OutcomeReceipt.content_hash is the settlement authority; raw decision_id and proof_binding are never settlement authority;
- invalid transitions are rejected;
- retries/recovery are deterministic and idempotent;
- the ClaimRecord is immutable after CLAIMED;
- GP-001 settlement recipient authorization is derived only from the recorded ClaimRecord claimant.

## 4. Mandatory anti-double-release model

The frozen G1 settlement_key is instruction-level idempotency only:

```
settlement_key =
SHA256(
  "intent-protocol/v1/settlement-key"
  || 0x00
  || outcome_receipt_hash[32]
  || UTF8(escrow_ref)
  || 0x00
  || nonce_u64be[8]
)
```

Because nonce is an instruction input, changing nonce changes settlement_key. Therefore settlement_key alone MUST NOT be used as the economic double-release guard.

GP4 MUST implement two independent uniqueness layers:

### A. Economic release uniqueness

The escrow ledger MUST enforce a unique immutable release authority key:

```
(escrow_ref, outcome_receipt_hash)
```

For a given pair:
- at most one successful RELEASE is permitted;
- after RELEASED, any SettlementInstruction using the same pair, including a different nonce and therefore a different settlement_key, MUST return an idempotent already-released/rejected result and MUST NOT create a second transfer;
- crash/retry recovery MUST preserve this invariant.

### B. Instruction idempotency

```
settlement_key
```

deduplicates exact/retried settlement instructions.

Normative distinction:

```
(escrow_ref, outcome_receipt_hash)
= economic exactly-once release guard

settlement_key
= instruction replay/idempotency guard
```

GP4 cannot PASS unless both are machine-tested.

## 5. G3 execution + evidence

Builder C runs the Agent in an isolated execution environment.

Required execution inputs:
- frozen Intent / intent_hash
- frozen Milestone identity
- repository + base SHA
- task text
- allowed tools
- allowed/forbidden paths

Required execution outputs:
- ExecutionRef
- patch commit SHA
- git diff
- stdout/stderr
- exact test/build commands
- test/build results
- workspace manifest
- timestamps

Evidence artifacts are hashed and packed into EvidenceBundleV1. A submitted bundle used for verification MUST be SEALED and its merkle_root MUST recompute.

The Agent cannot create or mutate:
- VerificationDecision
- OutcomeReceipt
- settlement eligibility
- release state

## 6. G3/G4 independent verification policy

GP-001 uses a frozen **2-of-2** verification policy with two distinct verifier identities.

### Verifier A — Functional

From a clean environment:
- checkout frozen base / submitted patch commit as specified;
- install dependencies from the frozen lockfile;
- run the frozen acceptance suite;
- run existing tests;
- run build/typecheck.

### Verifier B — Policy / provenance

Independently verify:
- base SHA ancestry;
- changed-path allowlist / denylist;
- acceptance-suite immutability;
- patch scope;
- evidence artifact hashes;
- EvidenceBundle merkle root;
- Milestone identity;
- policy hash / frozen target;
- R9 proof_binding recomputation.

Each verifier emits its own VerificationDecisionV1.

### Decision vocabulary mapping

In this GP contract, prose such as "verifier ACCEPT", "ACCEPTS", or runtime verification state `ACCEPTED` maps to the frozen G1 wire condition:

```
VerificationDecisionV1.result === "VALID"
```

No `"ACCEPT"` result value may be invented. The other frozen wire values remain `INVALID`, `INSUFFICIENT`, and `DISPUTED`.

Requirements:
- verifier identities MUST be distinct;
- both decisions MUST target the same frozen milestone/bundle/policy binding;
- both decisions MUST have `result === "VALID"` for receipt formation;
- OutcomeReceipt.decision_hashes MUST be non-empty, unique, strictly lexicographically sorted;
- no manual/admin/demo path may create an accepted receipt.

## 7. OutcomeReceipt and settlement boundary

Receipt Engine may form OutcomeReceiptV1 only after the frozen 2-of-2 policy is satisfied.

Settlement Engine accepts only the accepted OutcomeReceipt content hash as authority.

### GP-001 payee binding

The economic beneficiary is frozen at CLAIM time, not settlement-formation time.

For GP-001, a conforming SettlementInstruction MUST satisfy ALL of:

```
outputs.length == 1
outputs[0].recipient == ClaimRecord.claimant
outputs[0].asset == {
  network: "solana-devnet",
  asset: "USDC-test",
  decimals: 6
}
outputs[0].amount == "10"
total_amount == "10"
escrow_ref == TaskFreezeRecord.escrow_ref
```

Recipient comparison is exact equality of the parsed SubjectRef string. Settlement formation MUST read the immutable ClaimRecord; callers may not supply/override the payee. Any recipient mismatch MUST be rejected before settlement becomes ELIGIBLE.

This binding is a GP runtime authorization rule and does not modify MilestoneV1 or any frozen G1 wire object.

Forbidden settlement authorities:
- decision_id
- proof_binding
- manual button
- demo flag
- admin override
- hard-coded ACCEPT

Required GP4 negative cases:
1. valid receipt -> one RELEASE;
2. exact instruction replay -> no second release;
3. same receipt + different nonce -> no second release;
4. tampered receipt -> reject;
5. one verifier ACCEPT only -> no receipt / no settlement;
6. evidence tamper -> verification fails / no receipt;
7. wrong milestone/bundle/policy binding -> reject;
8. crash/retry after release boundary -> still exactly one economic release;
9. settlement recipient != recorded ClaimRecord claimant -> REJECT / no RELEASE.

## 8. Proof Pack

GP5 MUST produce a self-verifiable Proof Pack. Hashes alone are insufficient.

Minimum contents:

### Full objects
- GP-001 Task Freeze Record + its exact file bytes + task_freeze_hash
- immutable ClaimRecord
- IntentContractV1
- MilestoneV1
- EvidenceBundleV1
- both VerificationDecisionV1 objects
- OutcomeReceiptV1
- SettlementInstructionV1

### Execution / raw evidence
- ExecutionRef / execution manifest
- base commit SHA
- Agent patch commit SHA
- git diff
- frozen acceptance-suite identity
- relevant stdout/stderr and test/build outputs
- evidence artifacts needed to recompute artifact hashes and bundle merkle_root

### Settlement evidence
- recorded claimant SubjectRef
- proof that SettlementInstruction has exactly one output and its recipient equals the recorded claimant
- escrow_ref
- escrow ledger entry/history
- economic release uniqueness key `(escrow_ref, outcome_receipt_hash)`
- settlement_key
- pre/post settlement states
- payment/transfer reference (local ledger ref and, if GP5 exercises the authorized devnet adapter, devnet tx ref)

### Reproduction
- `verify.mjs` (or equivalent single command) that recomputes:
  - object content hashes
  - bundle merkle_root
  - both R9 proof_bindings
  - sorted/unique decision_hash commitment
  - OutcomeReceipt hash
  - settlement_key
  - escrow economic exactly-once condition

A third party with the Proof Pack MUST be able to verify the complete chain without trusting Builder C's claims.

## 9. Demo-path integrity

There is one success path. Demo mode MUST NOT have a privileged acceptance/release path.

Forbidden patterns include:
- `DEMO_ACCEPT`
- `forceReceipt`
- `skipVerification`
- `mockSuccess`
- `adminRelease`
- hard-coded ACCEPT / fabricated OutcomeReceipt

GP5 evidence MUST include:
1. static scan / review evidence for prohibited bypass hooks; and
2. black-box negative-path proof showing that an unverified submission cannot produce OutcomeReceipt or RELEASE; and
3. path/trace evidence showing the demo traverses the same Receipt -> Settlement authority boundary as the normal runtime.

Static string scanning alone is not sufficient.

## 10. Gate contract

### GP0 — Contract Freeze

PASS requires:
- this contract merged to default branch;
- independent Builder D audit finds no untestable/contradictory acceptance rule;
- GP-001 Task Freeze Record schema/required fields are frozen, including `max_attempts = 3`;
- payee authorization is frozen as immutable ClaimRecord claimant -> exactly one SettlementInstruction output recipient;
- asset/reward/verification policy/release uniqueness model are frozen;
- no G1 semantic modification.

Concrete repository/base-SHA/path/deadline/escrow values are frozen by the committed Task Freeze Record before GP2; GP0 freezes the record contract and the no-free-variable requirements.

### GP1 — G2 State Machines

PASS requires:
- deterministic legal transitions;
- all invalid transitions rejected;
- idempotent retry/replay;
- crash/recovery tests;
- independent Builder D replay.

### GP2 — G3 Execution + Evidence

PASS requires:
- committed `packages/golden-path/fixtures/gp-001-task.json` exists and matches the GP0 record contract;
- Builder D verifies `task_freeze_hash` and equality of its facts against Intent/Milestone/runtime inputs;
- isolated Agent execution on the real frozen task;
- real patch commit;
- reproducible acceptance/build commands;
- SEALED EvidenceBundle with recomputable merkle_root;
- one-byte tamper causes verification failure;
- independent clean-environment reproduction.

### GP3 — Independent Verification + OutcomeReceipt

PASS requires:
- two distinct independent verifiers;
- 2-of-2 policy where both frozen G1 decision results equal `"VALID"`;
- both R9 bindings independently recomputed;
- rejected/single-verifier paths cannot form receipt;
- accepted OutcomeReceipt exactly matches the frozen G1 wire rules.

### GP4 — Settlement + Replay Protection

PASS requires:
- OutcomeReceipt-gated local settlement;
- exactly one GP-001 output whose recipient equals the immutable ClaimRecord claimant, amount is `"10"`, and asset is the frozen triple;
- wrong-recipient SettlementInstruction is rejected before ELIGIBLE;
- unique economic release key `(escrow_ref, outcome_receipt_hash)`;
- settlement_key instruction idempotency;
- same receipt with different nonce cannot double release;
- all negative cases in section 7;
- recovery after crash/retry;
- complete reverse traceability.

### GP5 — Full E2E Golden Path

PASS requires one uninterrupted GP-001 run:

```
Sponsor creates/funds bounty
-> Agent claims (immutable ClaimRecord records claimant)
-> Agent executes and commits patch
-> EvidenceBundle SEALED
-> Verifier A independently ACCEPTS
-> Verifier B independently ACCEPTS
-> OutcomeReceipt formed
-> SettlementInstruction formed with recipient == recorded claimant
-> escrow RELEASED exactly once to that claimant
-> replay/different-nonce second release blocked
-> Proof Pack independently verifies
```

GP5 is the first product-closure evidence. It is not production/mainnet evidence.

## 11. Roles

### Builder C — Runtime / Execution

Owns:
- G2 runtime state machines
- immutable ClaimRecord creation/storage
- GP-001 Task Freeze Record implementation/consumption
- Agent runner
- ExecutionRef
- evidence packaging
- local escrow / settlement consumer

Forbidden:
- self-authorizing verification success
- creating accepted receipt outside policy
- modifying Builder D verifier to make implementation pass

### Builder D — Independent Verifier

Owns:
- GP0 contract audit
- independent gate harnesses
- Functional Verifier
- Policy/Provenance Verifier
- independent R9 recomputation
- black-box receipt/settlement negative tests
- Proof Pack independent verifier

Builder D MUST treat Builder C output as untrusted input and MUST NOT fix Builder C implementation.

### Commander

Owns:
- scope
- contract
- gate rulings
- freeze exceptions
- PASS/REJECT signatures

Machine READY is not a Commander PASS.

## 12. Freeze discipline

GP0 freezes the GP-001 contract and gate semantics. After GP0 PASS:
- no scope expansion for convenience;
- no success-path exceptions;
- no G1 semantic changes;
- any change that affects acceptance, authorization, or release uniqueness requires Commander review before implementation.

G1 remains frozen. GP0 does not reopen G1.
