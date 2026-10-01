# USER-EVIDENCE-R0 — Experiment Contract (UE-0 Freeze)

Status: **REVISED per CUT-1R (Command Freeze + Dual-Hash Contract) — awaiting adjudication**

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

## 3. UE-0 PASS conditions (CUT-1R form — dual-hash contract binding)

```text
UE0-R1 precommit flips when Tier1 amount changes
UE0-R2 precommit flips when Tier2 amount changes
UE0-R3 payer/worker identity change invalidates binding (every frozen
      command too; identity-stable on unchanged input)
UE0-R4 all required fields strict-validated (each miss named)
UE0-R5 all sha256 fields exact grammar ^sha256:[0-9a-f]{64}$

Dual hash (single source, schema.ts):
  VERIFICATION_RULESET_HASH = verification rules + frozen COMMANDS only
  CONTRACT_FREEZE_HASH      = payer + claimant + tier1_reward + tier2_reward
                             + claim mode + auto_release=ABSENT +
                             tier2_execution=ABSENT + verification_ruleset_hash
  payer_precommit binding → CONTRACT_FREEZE_HASH + exact words + timestamp.
  The precommit commits to the MONEY and the RULES — a post-hoc tier1/tier2
  swap is structurally detectable (product constitution enforced here).
```

## 4. UE-1 — Real Task Freezer (CUT-1R form — command freeze, real enforcement)

CLI: `intent experiment freeze <repo> <task-config>` — the contract freezes
COMMAND STRINGS (not just test paths; real repos are not all Vitest):
regression_command / baseline_health_command / patched_acceptance_command /
optional build+typecheck / package_manager / install_command — all inside the
hashed contract. Preflight in a temp STAGING dir, ATOMIC publish only after
every check passes; ANY miss → INELIGIBLE with the output dir untouched.

```text
UE1-R1 regression_command REALLY FAILS at base (executed in sandbox)
UE1-R2 baseline_health_command REALLY PASSES at base (executed in sandbox)
UE1-R3 dependency env reconstructed CLEAN-ROOM from the frozen lockfile
      (vendored node_modules removed first; npm ci with frozen lockfile)
UE1-R4 network access attempt REALLY FAILS inside the sandbox
      (macOS sandbox-exec (version 1)(allow default)(deny network*);
       Linux unshare -n) — negatively probed: TCP 1.1.1.1:53 must FAIL,
       local execution must still work
UE1-R5 same frozen commands + same base reproduce the SAME results N times
UE1-R6 failed freeze leaves ZERO publishable artifact set (stale outputs
      from a previous run are never overwritten or mistaken for success)

Deferred to UE-2 with explicit gates (NOT claimed by UE-1):
  UE2-PATH-DENY          forbidden-path patch enforcement
  UE2-DEPENDENCY-DENY    dependency-addition rejection
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
