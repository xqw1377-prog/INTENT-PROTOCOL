# EXPERIMENT-001 — Real User Evidence (GO)

Status: **GO (Commander order 2026-10-03). The repository self-proof
phase is CLOSED; what follows happens outside this repository.**

Basis: PRODUCT-THESIS-R0 = PASS / FROZEN; USER-EVIDENCE-R0 MACHINE =
PASS / FROZEN-R0 (UE-0..UE-5, Commander @ CUT-2R1 ca0c646). Technical
readiness = YES. What is NOT proven and must not be claimed:
product-market fit, payer demand, commercial viability.

## EXPERIMENT-001 TRUST ANCHOR (frozen — package-external by design)

A proof pack can never establish verifier trust; this governance record
does. Every EXPERIMENT-001 freeze/report cites exactly these values:

```text
MAIN (merged, post-sign-off)   = fe18be0a5eb9536a7d2e0325352cb6ed0d7bbc90
IMPLEMENTATION AUDIT SHA       = ca0c64673a759a713c2cf18813cb22b7fc005741
                                 (Commander-audited CUT-2R1 tip; frozen
                                 audit branch audit/user-evidence-r0-cut2-cut4)
VERIFIER-RELEASE.json SHA256   = sha256:25286e96bd346bd34fa093d40968f690ae357a4d9ece59f9af6c925747cb6027
portable-replay.mjs SHA256     = sha256:292d580430dbe39c2978060340d2e4d27dd8debcfc807ba5f0a5e6157cbc8493
```

Third-party verification order (frozen in the release file): obtain
VERIFIER-RELEASE.json from this repository at the MAIN SHA above →
compare the pack's verify.mjs hash and proof-manifest verifier_sha256
against it → only then run `node verify.mjs`. The answer to "what
version was the experiment run on?" is this block, and nothing else.

## First-maintainer selection criteria (harsh on purpose)

> Operations kit (English first-contact message, hard screening
> checklist, operator runbook): docs/experiments/EXPERIMENT-001-OPS.md.

The first task must be boring to the point of having almost no
subjective space. We are not testing AI coding ability; we are testing
whether a maintainer will concede, BEFORE seeing the outcome, that
whoever satisfies the pre-frozen rules has earned the Tier-1
entitlement.

```text
REQUIRED
  REAL OSS repo · REAL maintainer
  npm + package-lock; npm ci --ignore-scripts builds the test env
  one real, currently-existing bug
  regression_command        → BASE must be RED
  baseline_health_command   → BASE must be GREEN
  small fix scope · no symlink changes · no new dependencies
  no external APIs · no network-dependent tests
  no DB/infra side effects · no complex human quality judgment
  expected patch           = small and unambiguous
```

Non-npm repos are INELIGIBLE for this experiment by ruling (install
authority, CUT-2R1) — that is acceptable for the first transaction.

## Recruitment discipline (do not sell Intent first)

First contact talks about the experiment, not the protocol, the
blockchain, or the proof architecture:

> 你有一个真实 bug。我们在任何人修它之前，把"什么算修好"冻结。
> 外部贡献者完成后，另一台机器从冻结基线独立重跑。
> 我们唯一想验证的是：如果事前标准全部满足，你是否愿意承认这部分
> 奖励已经被贡献者赚到，而不是事后重新定义标准。

Then the ONE qualifying question, before showing any solution:

> 你愿不愿意在看到解决方案之前，先签下这个规则？

A refusal is not a failure — it is exactly the user evidence this
experiment exists to collect. If the answer is "no", record it in the
ledger (payer_accepts = false path) rather than shopping for a
friendlier maintainer.

## Ledger targets (the six lines this experiment converts)

```text
REAL PAYER                            = 0 → 1
REAL TASK                             = 0 → 1
REAL EXTERNAL WORKER                  = 0 → 1
PAYER PRE-COMMIT                      = NO-EVIDENCE → YES
THIRD-PARTY REPLAY                    = simulated → REAL TASK SAME
PAYER ACCEPTS TIER-1 AFTER DELIVERY   = NO-EVIDENCE → YES/NO OBSERVED
```

Recording uses UE-5 exactly as frozen: observations append-only with
provenance + attestation class; ONE final ledger per experiment; user
evidence is OBSERVED / SIGNED-STATEMENT-RECORDED, never conflated with
TECHNICAL EVIDENCE = VERIFIED. One experiment ≠ product-market fit.

## Standing boundaries (unchanged)

PRE-MONEY / TESTNET-VALUE ONLY · single claimant · Tier-1 only · no
auto-release · no chain writes required · MAINNET DENIED · REAL FUNDS
DENIED · PROTOCOL EXPANSION / UNIFIED CLI / UI / PAYMENTS / CONCURRENT
CLAIM / TIER-2 ENGINE = HOLD.
