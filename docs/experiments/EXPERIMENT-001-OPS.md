# EXPERIMENT-001 — Operations Kit

Status: **GO (Commander, 2026-10-03: FRONTEND-R1 = PASS; real-maintainer
experiment authorized).** This kit supports the out-of-repo work: finding
one real maintainer, one pre-designated external worker, and running the
first real task through the frozen flow. The charter and trust anchor
live in EXPERIMENT-001.md. Pre-money / symbolic reward only; real funds
DENIED; all HOLD surfaces unchanged.

## 1. First-contact message (English — do NOT sell Intent first)

> Hi — we're running a small, facilitated experiment about pre-agreed
> standards in open-source work, and your repo looks like a good fit.
>
> You have a real bug. Before anyone touches it, we freeze exactly what
> counts as fixed: which tests must go from red to green, which files may
> change, how big the patch may be. An external contributor then does the
> fix. A separate machine re-runs everything from the frozen baseline.
>
> The one thing we're testing: if the pre-agreed conditions are all
> satisfied, will you acknowledge that the fixed reward for that part has
> been earned — rather than redefining the standard afterwards?
>
> Would you be willing to sign off on the rules BEFORE seeing the
> solution?

Rules of engagement: no protocol talk, no blockchain, no proof
architecture, no product pitch in the first contact. If the answer is
"no" — record it as user evidence (that refusal IS data), do not shop
for a friendlier maintainer in the same round.

## 2. Candidate-repo screening (hard pass/fail, per the frozen charter)

```text
[ ] real OSS repo, real maintainer who answers
[ ] npm + package-lock committed
[ ] `npm ci --ignore-scripts` builds the test environment (check locally)
[ ] one real, currently-existing bug with a writable regression test
[ ] regression test is RED at the pinned base commit
[ ] existing suite is GREEN at the pinned base commit
[ ] deterministic: N consecutive red/green reproductions (the UI's
    Check-eligibility proves this — no hand-waving)
[ ] fix scope small: allowed_paths ⊂ src/**-like; tests/lockfile/CI protected
[ ] no symlink changes, no new dependencies, no external APIs,
    no network-dependent tests, no DB/infra side effects
[ ] expected patch small and unambiguous (boring on purpose)
[ ] reward: Tier-1 symbolic/testnet amount; Tier-2 = 0 for this experiment
[ ] worker: pre-designated BEFORE freeze (single claimant), external,
    not affiliated with the maintainer
```

Non-npm repos are INELIGIBLE this round (install-authority ruling) —
decline politely and move on.

## 3. Operator runbook (the facilitated session)

```text
PREP    clone the candidate repo locally; pin the base commit;
        write the regression test with the maintainer (it must be red);
        confirm identities: payer_identity / worker_identity (declared)
F1      apps/experiment-ui/start.sh <experiment-dir>
        → maintain the form with the maintainer present
        → Check eligibility (real preflight; minutes)
        → the maintainer READS the complete terms and clicks
          "Freeze these rules" themselves (their action, their machine
          or a session they can see; consent is OBSERVED, not authenticated)
F2      send the worker the frozen task view (rules locked, earn
        conditions, single-claimant notice)
F3      worker submits ONE patch (paste/file) — immutable once submitted
F4      Run primary verification → then Independent replay
        (the trusted verifier executes from the anchored bytes; the
        EARNED screen appears only if BOTH pass with current bindings)
F5      with the maintainer: Q1 (verbatim required) / Q2 / Q3;
        "Answer later" records nothing and blocks finalize until
        answered or explicitly closed by the operator (provenance kept)
FINAL   Finalize experiment → the one final ledger; conclusion
        STRENGTHENED / MIXED / CHALLENGED; "One experiment is not
        evidence of product-market fit."
AFTER   the experiment dir (freeze pack, proof pack, observations,
        final ledger) is the durable record; third parties can verify
        the proof pack with the anchored verifier instructions
```

Incident notes: an interrupted verification is NOT an INVALID — keep the
bytes and inspect; INVALID is terminal for the run (no retry UI); any
evidence error surfaced by the UI is operator-inspection territory.

## 4. What success converts (unchanged charter targets)

REAL PAYER 0→1 · REAL TASK 0→1 · REAL EXTERNAL WORKER 0→1 ·
PAYER PRE-COMMIT → YES · THIRD-PARTY REPLAY → REAL TASK SAME ·
PAYER ACCEPTS → YES/NO OBSERVED. One experiment ≠ product-market fit.
