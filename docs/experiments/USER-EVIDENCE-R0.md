# USER-EVIDENCE-R0 — Experiment Contract (UE-0 Freeze)

Status: **FROZEN for adjudication (CUT-1: UE-0 + UE-1 only)**

Authority: Commander order `USER-EVIDENCE-R0 / CUT-1 = GO` (2026-10-01).
Product north star: a real repo owner freezes Tier-1 rules BEFORE work
begins; a real external worker does the task; a third party replays the
proof; we observe whether the payer acknowledges the Tier-1 entitlement as
irrevocable. Technical proof ≠ user evidence — never conflated.

## 1. Standing boundaries

```text
EXPERIMENT MODE   = PRE-MONEY / TESTNET-VALUE ONLY
CLAIMS            = SINGLE CLAIMANT / SERIAL ONLY (hard-coded for R0)
TIER 1            = YES
TIER 2 EXECUTION  = NO — pre-declaration recorded, no dispute machinery
AUTO RELEASE      = NO (silence→release authority = HOLD, separate gate)
CHAIN WRITE       = NOT REQUIRED (no chain writes in UE-R0)
GP-001 FROZEN TASK FREEZE RECORD = UNTOUCHED (separate object below)
MAINNET           = DENIED
REAL FUNDS        = DENIED
Web/marketplace/frontend/wallet onboarding = HOLD
```

## 2. RealTaskExperimentV1 — schema (UE-0)

A NEW object, deliberately separate from the historical GP-001 Task Freeze
Record. Frozen fields (NO free Tier-1 judging variable may remain after
START):

```text
experiment_id
repository_url
base_commit_sha

payer_identity
worker_identity            (bound at claim time; single claimant)

acceptance_suite          (the frozen FAIL→PASS regression + full-suite spec)
acceptance_suite_sha256

lockfile_path
lockfile_sha256

allowed_paths
forbidden_paths           (tests / fixtures / CI / workflows / lockfile)

max_diff_lines
new_dependencies_allowed  = false (hard-coded false in R0)

network                   = disabled (hard-coded in R0)
determinism_runs          = N (frozen at freeze time; default 3)

tier1_reward
tier2_reward              (declared, priced, NOT executed in R0)

claim_mode                = SINGLE_CLAIMANT (hard-coded)

payer_precommit_text      (exact wording; hash-bound to ruleset_hash)
payer_precommit_timestamp

ruleset_hash              (sha256 over canonical ruleset bytes — single
                           source: the same constants the validators run)
```

## 3. UE-0 PASS conditions

```text
UE0-01 schema has no unresolved Tier-1 variable
      (every judging fact fixed before worker execution)
UE0-02 payer precommit is hash-bound to ruleset
      (precommit recorded BEFORE any outcome exists)
UE0-03 single-claim only is hard-coded for R0
UE0-04 auto-release explicitly absent
UE0-05 Tier-2 execution explicitly absent
```

## 4. UE-1 — Real Task Freezer (CUT-1's build)

CLI: `intent experiment freeze <repo> <task-config>` → emits
`experiment/task.json`, `experiment/ruleset.json`,
`experiment/freeze-manifest.json` with base SHA / suite hash / lockfile
hash / ruleset hash. Preflight runs BEFORE any publication:
base checkout → regression MUST FAIL (real red); full suite → agreed
baseline; network-off sandbox runnable; lockfile reproducible; forbidden
paths resolvable. ANY miss → `TASK = INELIGIBLE` (never "publish first").

```text
UE1-01 exact base commit exists (git object database, never live worktree)
UE1-02 base regression is RED
UE1-03 suite bytes hash frozen
UE1-04 lockfile bytes hash frozen
UE1-05 sandbox network-off runnable
UE1-06 N-run determinism configurable and frozen
UE1-07 forbidden paths enforced
UE1-08 dependency-addition denied
UE1-09 resulting ruleset hash deterministic (same input → same hash)
UE1-10 freeze output reopens byte-identically (round-trip)
```

## 5. Later cuts (NOT authorized by CUT-1)

UE-2 runner / UE-3 proof builder / UE-4 third-party replayer /
UE-5 user-evidence recorder — design-only references live in the Commander
order; no code until separately authorized. `experiments/001/` may only be
created when a REAL maintainer + REAL repo + REAL bug exist. No fictional
fixtures.

## 6. Final experiment ledger (the ONLY allowed report form)

```text
REAL PAYER / REAL TASK / REAL EXTERNAL WORKER / PAYER PRE-COMMIT
BASE RED / PATCH GREEN / FULL SUITE / THIRD-PARTY REPLAY (SAME|DIFFERENT)
PAYER ACCEPTS TIER-1 ENTITLEMENT / POST-HOC RULE CHANGE REQUEST (0|N)
REPEAT-FUND INTENT (YES|NO|NOT ASKED)
→ exactly one of: THESIS STRENGTHENED | THESIS MIXED | THESIS CHALLENGED
One experiment ≠ product-market fit.
```
