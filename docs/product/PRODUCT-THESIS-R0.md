# PRODUCT-THESIS-R0 — First Real Task Card (PT-5, rev. PT-5R)

Status: **PT-5 CONDITIONAL PASS → PT-5R revision applied — awaiting final
Commander adjudication for PASS / FROZEN**

NATURE: product thesis, NOT engineering. Nothing in this card authorizes
code, contracts, chain writes, or protocol changes.

Evidence base: PT-1/PT-2/PT-2R/PT-3 (adjudicated). Evidence discipline per
PT-3 amendments: "NOT FOUND IN REVIEWED PUBLIC MATERIAL" ≠ categorical
absence; "documented failure case" ≠ platform-wide rate.

---

## The wedge (frozen from PT-1/PT-2R/PT-3)

```text
PRIMARY PAYER   = repository owner / software team (OSS bounty = first
                  acquisition channel, not proven TAM)
FIRST TASK      = regression-verifiable bug fix (frozen suite FAIL→PASS)
PRODUCT DEFINITION:
  Intent is not inventing verification or escrow. It turns
  WHO HAS EARNED / WHO MAY STILL REFUSE / WHAT HAPPENS ON SILENCE
  into one portable contract state anyone can verify.
CORE SENTENCE (EN):
  You may reserve the right to reject. You may not reserve the right
  to disappear.
FOURTH QUESTION (PT-5R — the key structural find):
  WHAT HAS ALREADY BECOME IRREVOCABLE?
  Which entitlement, once mechanically earned, cannot be clawed back by
  later subjective judgment.
CARDINAL PRODUCT PRINCIPLE:
  Mechanical entitlement cannot be retroactively converted into
  discretionary entitlement.
ANTI-GHOST = commercially proven primitive (Upwork 14d / Fiverr 3d-8d),
  NOT an Intent invention. The difference: WHAT FACT IS ELIGIBLE TO START
  THE COUNTDOWN — Intent's Tier-1 fact is mechanically frozen and replayable,
  Upwork's is a freelancer's submission (discretionary object).
```

## Deliberate scope choice for the FIRST card

Per the Commander's PT-5 guidance: the first pre-money task is chosen to
land **almost entirely in Tier 1** — verify the irreplaceable core first;
do not carry the human-dispute machinery into the first transaction.

---

# FIRST REAL TASK CARD

```text
PAYER
  A repository owner / software team with a testable bug in a repo they
  control. First acquisition channel: GitHub-native OSS bounty workflow.
  (Documented pain on this channel: algora-io/algora#174 — contributor
  reports solved bounty → no testing/payment → prolonged ghosting. A public
  failure CASE, not a platform-wide rate.)

WORKER
  Any agent or human. The protocol does not care which; identity binds via
  the immutable ClaimRecord (CLAIM-time claimant, frozen before execution).

TASK
  Fix one seeded-real bug in the payer's repository such that a FROZEN
  acceptance suite transitions FAIL→PASS on the FROZEN base, with the full
  existing suite staying green.

VALUE
  The payer pays only for a verified outcome, not effort or hours.
  TARGET GUARANTEE (not yet production-proven): the product is designed so
  a mechanically qualified worker cannot be silently denied. Entitlement
  determination is deterministic by frozen proof; economic auto-release is a
  B-class authority awaiting its own gate. Both sides are designed to lose
  the right to disappear — this is the thesis to be tested, not a current
  capability claim.

OUTCOME (Tier 1 — mechanically frozen, deterministic)
  1. base_commit_sha        — exact git object; runner materializes from the
                              object database, never a live worktree
  2. acceptance_suite_sha256— hash of the frozen suite incl. the
                              fail-on-base regression test
  3. lockfile_hash          — dependency drift = non-replayable = disqualified
  4. sandbox                — network-disabled; deterministic; N consecutive
                              green runs (flaky suite = task ineligible)
  5. patch scope            — allowed/forbidden paths frozen (tests, fixtures,
                              CI config, workflows all forbidden);
                              diff-size bound; no new dependencies
  6. winner                 — first experiment: SINGLE CLAIMANT / SERIAL
                              CLAIM ONLY (PT-5R). Concurrent claims are OUT
                              OF SCOPE until ATOMIC-CLAIM-R0 exists.
                              Winner-known→exactly-once payout on
                              (escrow_ref, outcome_receipt_hash) is PROVEN
                              (T2, Custom(108)); concurrent winner
                              arbitration (11B) is OPEN and NOT claimed.

EVIDENCE
  Outcome Proof (portable pack): frozen base bytes, frozen suite bytes,
  patch, sandbox runs (base red / patched green, N-run determinism),
  full-suite green, patch-scope proof, claim record, settlement record.
  Any technically capable third party can independently replay the pack
  and re-derive the same verdict outside the original service.

PAYMENT (PT-5R: the MONEY is tiered, not just the judgment)
  TOTAL BOUNTY = TIER 1 REWARD + TIER 2 REWARD  (split frozen pre-execution;
  the ratio is a per-task parameter — the STRUCTURE is the product)
    TIER 1 REWARD — mechanically earned amount
      Tier-1 VALID (2-of-2 replay of frozen ruleset) → the Tier-1 amount is
      an IRREVOCABLE entitlement of the recorded claimant. The payer cannot
      retroactively convert it into discretionary entitlement (cardinal
      principle). DETERMINATION is deterministic by frozen proof.
      ECONOMIC AUTO-RELEASE remains a B-class authority (see FAILURE of
      claims discipline below) — until its gate is proven, "earned"
      ≠ "auto-wired to rails".
    TIER 2 REWARD — separately priced discretionary amount
      Subject to the pre-declared review right (grounds may be arbitrary but
      MUST be declared pre-execution), window T, frozen consequence.

VERIFIER
  Two independent verifiers re-run the SAME frozen suite against the SAME
  frozen base with the patch applied (2-of-2 policy, frozen hashes).
  The worker NEVER verifies their own result (frozen principle #4).
  Verifier identities and decision signatures are part of the proof.

RULESET (all frozen BEFORE execution starts — the Task Freeze Record)
  base SHA / suite SHA / lockfile SHA / allowed+forbidden paths /
  max_attempts (=3) / max diff size / sandbox spec (network-off, N-runs) /
  payment split / review window T / silence consequence / dispute path.

(Payment is defined in the tiered PAYMENT block above — PT-5R keeps a
single source of truth for the money split.)

FAILURE (no payment)
  suite not red on base / not green on patch / any existing test broken /
  patch touches forbidden paths / diff over bound / new dependency /
  flaky runs / lockfile drift / claim not first / proof not replayable.

DISPUTE
  Replay the pack. The frozen ruleset decides; the discretionary tier (if
  exercised in-window) names its declared grounds and enters the frozen
  arbitration path. No dispute depends on any party's silence.

FREQUENCY
  Every failing test with a maintainer willing to fund it. OSS bounty
  boards already demonstrate repeat transactions (Algora 600+ bounties in
  its early era; TaskBounty's entire product). One repo → many tasks.

CURRENT ALTERNATIVE (evidence-disciplined wording)
  Algora: merge-discretionary; one DOCUMENTED public failure case
  (contributor reports solved→untested→unpaid→ghosting); no declared
  refusal authority or silence consequence found in reviewed material —
  a case, not a platform rate.
  TaskBounty: sandbox runs the existing suite; regression must fail on base
  and pass on fix; agent-side material even says "verification and wins →
  payout", while the maintainer side retains terminal review/merge/approval.
  Silence-after-verified-delivery consequence: NOT FOUND in reviewed public
  material. A portable, independently replayable proof FORMAT: NOT FOUND —
  stated as not-found, not as proven-absent.
  Upwork/Fiverr: pre-agreed deliverable + escrow + PROVEN silence
  consequence (official rules: Upwork 14-day auto-release; Fiverr 3-day
  standard / 8-day milestone) — but no mechanically frozen FAIL→PASS
  entitlement and no publicly documented third-party-replayable proof.

INTENT NECESSITY (delete-test against each element)
  Without RULE FREEZE      → platform/payer can judge post-hoc (Algora case).
  Without PORTABLE PROOF   → the worker lacks a protocol-native proof
                            artifact a third party can verify outside the
                            original service; for TaskBounty such a format
                            was NOT FOUND in reviewed public material.
  Without BINDING RELEASE → proof without consequence; payer can still
                            disappear (the #174 harm).
  Without the two-tier SPLIT → either taste vetoes everything (ghosting)
                            or mechanics alone certify quality (gaming).
  Among reviewed comparators, no system combines all four.

FIRST EXPERIMENT (pre-money, single-claim, user-evidence generator)
  REAL REPO + REAL MAINTAINER (payer) + REAL FAILING BUG + REAL OUTSIDE
  WORKER. Freeze the ruleset (money split included) → worker submits patch
  → independent 2-of-2 replay → Outcome Proof = VALID → then ask the payer,
  BEFORE revealing authorship/preferences:
    "According to the rules you agreed to before work began,
     has this worker earned the Tier-1 reward?"

  Machine-checkable success criteria (three, all required):
    PAYER ACCEPTS            = YES, Tier-1 entitlement is earned
    THIRD-PARTY REPLAY      = same verdict from the pack alone
    POST-HOC RULE CHANGE    = ZERO requests to re-judge Tier 1

  Reading the outcome (this is the user evidence the thesis needs):
    "Tests pass, but I won't admit the Tier-1 money is his"
      → thesis has a real problem (entitlement not accepted as irrevocable).
    "Tier 1 he earned; the quality bonus I dispute"
      → two-tier structure CONFIRMED by payer behavior.

  CONCURRENT CLAIMS: out of scope (single claimant only). Auto-release:
  not tested here (entitlement acceptance is the evidence sought; the
  silence-authority gate is separate future work).
```

---

## Thesis status (final — per Commander three-tier ruling)

```text
STRONG                          = NO
PLAUSIBLE / NEEDS USER EVIDENCE = YES
WEAK                            = NO

PRODUCT-THESIS-R0 (pending PT-5R adjudication) = PLAUSIBLE / NEEDS
USER EVIDENCE. Technical proof is strong; the missing evidence is
behavioral:
  REAL PAYERS VERIFIED                        = 0
  REAL TASKS                                  = 0
  REAL EXTERNAL WORKERS                       = 0
  PAYER PRE-COMMITS TO TIER-1 ENTITLEMENT    = NO-EVIDENCE
  PAYER ACCEPTS PROOF AS SUFFICIENT POST-HOC = NO-EVIDENCE
  WILLINGNESS TO REPEAT-FUND                 = NO-EVIDENCE
The first experiment exists to convert exactly these six lines.

GLOBAL UNIQUENESS = NO-EVIDENCE (only: no reviewed comparator has all four:
  mechanically pre-frozen entitlement / pre-declared refusal authority /
  deterministic silence consequence / portable replayable proof)

BIGGEST THREAT = TaskBounty (closest structure; watch for frozen ruleset
  hashes, portable proofs, silence rules)
BIGGEST RISK   = TEST PASS ≠ ACCEPTABLE FIX → handled BY DESIGN: the card
  refuses to claim quality; quality is Tier-2 money, declared, priced,
  time-boxed — never silently assumed. Cardinal principle: mechanical
  entitlement is never retroactively converted into discretion.
```
