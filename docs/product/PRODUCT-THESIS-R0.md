# PRODUCT-THESIS-R0 — First Real Task Card (PT-5)

Status: **DRAFT — awaiting Commander adjudication**

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
  The worker can never be ghosted on the mechanical tier (silence has a
  frozen consequence). Both sides lose the right to silently disappear.

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
  6. winner                 — FIRST VALID CLAIM wins (immutable ClaimRecord);
                              exactly-once payout on
                              (escrow_ref, outcome_receipt_hash)
                              — winner-known→single-payout is PROVEN (T2);
                              concurrent-claim arbitration is a listed
                              open mechanism (PT-2R 11B), not yet claimed

EVIDENCE
  Outcome Proof (portable pack, third-party replayable — the T5 pattern):
  frozen base bytes, frozen suite bytes, patch, sandbox runs (base red /
  patched green, N-run determinism), full-suite green, patch-scope proof,
  claim record, settlement record. Anyone can re-derive PASS/FAIL from the
  pack alone — including a court, an arbitrator, or the payer's own CI.

VERIFIER
  Two independent verifiers re-run the SAME frozen suite against the SAME
  frozen base with the patch applied (2-of-2 policy, frozen hashes).
  The worker NEVER verifies their own result (frozen principle #4).
  Verifier identities and decision signatures are part of the proof.

RULESET (all frozen BEFORE execution starts — the Task Freeze Record)
  base SHA / suite SHA / lockfile SHA / allowed+forbidden paths /
  max_attempts (=3) / max diff size / sandbox spec (network-off, N-runs) /
  payment split / review window T / silence consequence / dispute path.

PAYMENT
  Tier 1 (mechanical): on 2-of-2 VALID + frozen-scope clean, escrow
  releases to the recorded claimant, exactly once. DETERMINISTIC.
  Tier 2 (declared discretion — kept MINIMAL in the first card):
  payer holds a pre-declared, time-boxed review right ONLY over
  mechanical-tier defects that escaped the frozen rules (e.g. legal-but-
  broken edge the suite missed). Grounds may be "any reason" but MUST be
  declared pre-execution, with window T and consequence frozen.
  [Authority note per PT-2R Amendment-1: silence→auto-release is a NEW
   economic-authority contract — a B-class product mechanism requiring its
   own gate before any real-money claim.]

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

CURRENT ALTERNATIVE
  Algora: merge-discretionary, documented ghosting case, no declared
  refusal authority, no silence consequence found.
  TaskBounty: sandbox CI + fail→pass regression + maintainer merge/approval
  as terminal human authority; silence-after-verified-delivery consequence
  and third-party-replayable proof NOT FOUND in reviewed public material.
  Upwork/Fiverr: proven anti-silence escrow, but entitlement object is
  client-taste submission — nothing frozen, nothing replayable, nothing
  portable.

INTENT NECESSITY (delete-test against each element)
  Without RULE FREEZE      → platform/payer can judge post-hoc (Algora case).
  Without PORTABLE PROOF   → worker cannot prove entitlement to ANY third
                            party; proof locked in platform (TaskBounty's
                            published model), ghosting stays rational.
  Without BINDING RELEASE → proof without consequence; payer can still
                            disappear (the #174 harm).
  Without the two-tier SPLIT → either taste vetoes everything (ghosting)
                            or mechanics alone certify quality (gaming).
  Among reviewed comparators, no system combines all four.

FIRST EXPERIMENT (pre-money, deliberately Tier-1-heavy)
  One real OSS repo with a real failing test. Payer = maintainer.
  Small public bounty (testnet value). Freeze the full ruleset, run the
  flow end-to-end with an independent worker, produce the Outcome Proof,
  third-party replay it. Success criterion: all parties agree the pack
  alone decides Tier 1 — BEFORE any Tier-2 dispute machinery is built.
```

---

## Thesis status (unchanged discipline)

```text
THESIS            = PLAUSIBLE / STRONG-CANDIDATE (needs user evidence)
GLOBAL UNIQUENESS = NO-EVIDENCE (only: no reviewed comparator has all four)
BIGGEST THREAT    = TaskBounty (closest structure; watch for it adding
                    frozen ruleset hashes / portable proofs / silence rules)
BIGGEST RISK       = TEST PASS ≠ ACCEPTABLE FIX → mitigated BY DESIGN here:
                    the card refuses to claim quality; quality is Tier 2,
                    declared, priced, time-boxed — never silently assumed.
```
