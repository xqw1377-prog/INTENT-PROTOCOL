# INTENT PROTOCOL — Product Overview

Status: **CURRENT PRODUCT NARRATIVE (R1, 2026-10-22).** This document is
the entry point for what the product IS today. It supersedes nothing that
is frozen; it reconciles the frozen layers (thesis → spec → experiment)
and marks the vision layer's place. Owner: Commander; maintained by the
operator on order. Change discipline: any change here that widens a
standing boundary requires a Commander ruling first.

---

## 对齐摘要（one-screen TL;DR）

```text
产品一句话   Intent 把"谁已经赚到 / 谁仍可拒绝 / 沉默意味着什么"
             变成任何人都能独立验证的一份可携契约状态。
今天的产品   ①冻结证据机器（UE-0..UE-5，PASS/FROZEN-R0）
             ②本地协作实验编排器（F1–F5，PASS/FROZEN-R0）
             ③包外信任锚 + 可携验证器（第三方可离线复演）
当前阶段     EXPERIMENT-001 招募第三轮（赞助制条款，AMENDMENT-1），
             等待维护者回应；参与者 0、实验未跑、真实用户证据 0。
证据纪律     技术证据（机器可验证）与用户证据（观察到的行为）永远
             分开记录，绝不互相冒充。
不在产品内   链上结算（testnet 已证明、未授权）、mainnet、真实资金、
             代币、自动放款、并发认领、Tier-2 引擎、实验以外的 UI。
```

## 1. The wedge (frozen in PRODUCT-THESIS-R0)

The first real transaction is deliberately small: a repository owner
(the payer side of the relationship), one real bug whose fix is
regression-verifiable, and an external worker. Everything the product
asserts lives in one sentence pair:

```text
CORE SENTENCE (EN)
  You may reserve the right to reject. You may not reserve the
  right to disappear.

THE FOURTH QUESTION (what the product actually sells)
  WHAT HAS ALREADY BECOME IRREVOCABLE?
  Which entitlement, once mechanically earned, cannot be clawed back
  by later subjective judgment.

CARDINAL PRINCIPLE
  Mechanical entitlement cannot be retroactively converted into
  discretionary entitlement.
```

Anti-ghost (silence consequence) is a commercially proven primitive
(Upwork/Fiverr), not an Intent invention. Intent's difference: the fact
that starts the countdown is **mechanically frozen and replayable**, not
a discretionary submission.

## 2. What exists and is proven (2026-10-22)

| Artifact | What it is | Status |
|---|---|---|
| UE-0..UE-5 evidence machine (`packages/user-evidence-r0`) | dual-hash freeze contract · clean-room freezer · net-denied runner · 9-file proof pack · standalone portable verifier · append-only observation ledger | PASS / FROZEN-R0 |
| Local Orchestrator (`apps/experiment-ui`) | F1 freeze-with-precommit · F2 frozen task view · F3 one-patch submission · F4 two-stage verification (EARNED iff primary VALID ∧ trusted replay PASS) · F5 acknowledgment + verified-ledger view | PASS / FROZEN-R0 |
| Trust anchor | pinned main SHA + verifier-release SHA256 + portable-replay SHA256 (package-external by design: a pack can never vouch for its own verifier) | frozen in docs/experiments/EXPERIMENT-001.md |
| Main Health CI | full suite + typecheck sweep + checkout-purity gate on the reference environment | GREEN @ b513285 lineage |
| Chain settlement primitives (OutcomeReceipt → devnet exactly-once → failure reconciliation → third-party proof pack → golden run) | a closed, auditable loop | PROVEN on TESTNET; **NOT part of the experiment product; NOT authorized for any deployment** |

All of the above is TECHNICAL evidence — machine-verifiable, and all of
it local/simulated so far.

## 3. What is NOT proven (the honest scoreboard)

```text
REAL PAYER                                 = 0
REAL TASK                                  = 0
REAL EXTERNAL WORKER                      = 0
PAYER PRE-COMMIT TO TIER-1 ENTITLEMENT    = NO-EVIDENCE
PAYER ACCEPTS PROOF AS SUFFICIENT POST-HOC= NO-EVIDENCE
WILLINGNESS TO REPEAT-FUND                = NO-EVIDENCE
PRODUCT-MARKET FIT / DEMAND / VIABILITY   = UNPROVEN
```

Field status: recruitment ROUND 3 under sponsored terms (see §4) —
first contact re-sent 2026-10-22, UNANSWERED. One experiment, even
successful, is not evidence of product-market fit.

## 4. The experiment model (current operating shape)

Sponsored relationship per **EXPERIMENT-001-AMENDMENT-1** (ratified
2026-10-22): the sponsor funds the symbolic Tier-1; the maintainer is
rule-co-author + **acceptor** and never pays; the F5 answer is
ACKNOWLEDGMENT evidence ("the maintainer accepts that the frozen Tier-1
was earned under rules agreed before work began") — never citable as
payment-behavior evidence; sponsored conclusions are tagged
`(SPONSORED-RELATIONSHIP)`; "REAL PAYER 0→1" is not converted by a
sponsored run.

```text
PREP   identities declared · base pinned · frozen acceptance test
       co-authored WITH the maintainer (behavior-level: freeze the
       behavior, never the fix shape) · real preflight (F1 check)
F1     maintainer reads the complete terms and freezes them
       themselves (their action; consent observed, not authenticated)
F2     frozen task view goes to the pre-designated worker
F3     ONE patch submission — write-once, no retry semantics
F4     primary verification + independent trusted replay
       (EARNED only if BOTH pass with current bindings)
F5     the one question, verbatim, before any authorship is revealed;
       "answer later" records nothing and blocks finalize
FINAL  one final ledger; conclusion STRENGTHENED / MIXED / CHALLENGED
       with the framing tag; durable record third parties can replay
```

Trust model: identities are DECLARED (no authentication is claimed or
implied — R1 provides none); the verifier is anchored outside the pack;
any technically capable third party can re-derive the verdict offline.

## 5. Relationship to the whitepaper (V0.1, 2026-09-17)

The whitepaper and technical-architecture documents (V0.1, 2026-09-17,
`.docx` under docs/) are the **long-term Intent Infrastructure vision**:
Intent Contract (Goal ≠ Task, versioning), AI execution layer, six
first-class citizens, settlement infrastructure. Narrative status:
**HISTORICAL VISION — breadth unvalidated.**

Nothing in them is invalidated; the product DELIBERATELY narrowed (PT-5R
first-card discipline: land almost entirely in Tier 1; do not carry
dispute machinery into the first transaction) before making any breadth
claims. Mapping:

```text
Whitepaper pillar            Where it actually stands (2026-10-22)
Outcome First / Proof        → REALIZED as the UE/GP evidence chain and
  Before Payment               the frozen acceptance model (proven)
Settlement / chain           → testnet primitives PROVEN, held behind
                               "COMPLETE ≠ production authorization"
Intent Contract, execution   → future work, NOT current product, and
layer, token economics,        gated on user evidence that does not
six first-class citizens       exist yet (REAL PAYERS = 0)
```

Product claims must cite THIS document (or the frozen layer below it),
not the vision layer.

## 6. Document map

```text
docs/product/OVERVIEW.md            ← you are here; current narrative
docs/product/PRODUCT-THESIS-R0.md     frozen thesis card (wedge, tiers,
                                      first experiment, comparators)
docs/product/FRONTEND-R1-SPEC.md      frozen product spec (F1–F5, D1–D9,
docs/product/FRONTEND-R1.md           state machine, acceptance contract)
docs/experiments/EXPERIMENT-001.md    charter + frozen trust anchor
docs/experiments/EXPERIMENT-001-OPS.md  operator runbook, first-contact
                                        template, screening checklist
docs/experiments/EXPERIMENT-001-CANDIDATES.md  recruitment log (LIVE)
docs/AMENDMENTS.md                   governed changes (AMENDMENT-1 =
                                      sponsored relationship)
docs/USER-EVIDENCE-R0.md             UE machine gate record
README.md                            live governance ledger
docs/Intent_Protocol_Whitepaper_V0.1_2026-09-17.docx        historical
docs/Intent_Protocol_Technical_Architecture_V0.1_2026-09-17.docx  vision
```

## 7. Standing boundaries (unchanged)

PRE-MONEY / symbolic amounts only · single claimant · Tier-1 only · no
auto-release · no chain writes required by the experiment · MAINNET
DENIED · REAL FUNDS DENIED · TOKEN NOT-IN-SCOPE · PROTOCOL EXPANSION /
UNIFIED CLI / UI BEYOND THE EXPERIMENT PRODUCT / PAYMENTS / CONCURRENT
CLAIM / TIER-2 ENGINE = HOLD.
