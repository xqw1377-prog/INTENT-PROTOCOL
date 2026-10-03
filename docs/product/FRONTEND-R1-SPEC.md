# FRONTEND-R1 — Interaction Specification (FROZEN)

Status: **PRODUCT-UX-R0 = DESIGN PASS / FROZEN (Commander, 2026-10-03).
FRONTEND-R1 = IMPLEMENTATION GO. FIRST CUT = FR-1 + FR-2 ONLY.**

This document is the frozen design contract for the minimal experiment
product. Implementation must not widen it; gaps D1/D2/D3 and the
architecture are ruled below and are not open questions.

## 0. Final ruling

```text
PRODUCT-UX-R0   = DESIGN PASS
FRONTEND-R1     = IMPLEMENTATION GO
ARCHITECTURE    = LOCAL ORCHESTRATOR
PRODUCT MODE    = FACILITATED LOCAL EXPERIMENT (NOT self-service SaaS)
BACKEND         = UE-0..UE-5 FROZEN — frontend MUST CALL, NEVER REIMPLEMENT
```

The only goal of FRONTEND-R1:

> Maintainer and Worker need no understanding of hashes, CLIs, or
> proof internals to see WHEN rules are locked, WHEN Tier-1 has been
> earned, and what is still NOT decided by the system.

Core: `RULES → frozen · OUTCOME → independently verified · RIGHT → earned`

## 1. Information architecture

One experiment. No dashboard, no marketplace, no KPI. Top structure:
`INTENT / Experiment 001 / Overview · Task · Verification · Evidence`.
The real path is linear: F1 PREPARE & FREEZE → F2 FROZEN TASK →
F3 SUBMIT WORK → F4 VERIFY OUTCOME → F5 RECORD PAYER RESPONSE.

## 2. Global shell (desktop-first)

```text
┌────────────────────────────────────────────────────────────┐
│ INTENT                                      Experiment 001  │
│                                             ● FROZEN        │
├────────────────────────────────────────────────────────────┤
│  main content                                               │
├────────────────────────────────────────────────────────────┤
│ Frozen rules · Technical details · Experiment trust anchor  │
└────────────────────────────────────────────────────────────┘
```

Primary phase (only these): `DRAFT · READY TO FREEZE · FROZEN ·
SUBMITTED · VERIFYING · AWAITING PAYER · FINALIZED`.
Beside it, independent facts that never override each other:

```text
RULES   FROZEN / DRAFT          TIER 1  PENDING / EARNED / NOT EARNED
REPLAY  PENDING / PASS / FAIL   PAYER   PENDING / RECORDED
```

## 3. Three visual objects

**A. FROZEN** — cannot be changed after the fact (rules, money split,
payer, worker, base commit, acceptance conditions). Calm, sealed,
uneditable; lock/seal/thin-border language; optional monospace hash.
No Web3 glow, no blockchain icons.

**B. EARNED** — the strongest visual state in the product. Appears ONLY
when `primary verification = VALID AND independent replay = PASS`:

# EARNED
> **Tier 1 has been earned under the rules frozen before work began.**
> small print: This is a derived result, not a maintainer approval.

**C. STILL DISCRETIONARY** — R1 does NOT grant Tier-2 control
(`tier2_execution = ABSENT`): show "Tier 2 — Not evaluated in this
experiment". First experiment recommendation: `TIER 1 = 100% · TIER 2 = 0`.

## 4–8. F1 — Prepare & Freeze

Goal: the maintainer explicitly sees WHICH post-hoc discretion they are
giving up, BEFORE results exist. Title: "Prepare the task" / subtitle
"Define what must be true before anyone starts working."

**Step 1 WHO**: payer identity, assigned worker identity, "Single
claimant" — must state: "This experiment is frozen for this worker
only." (never reads as an open bounty).

**Step 2 CONTEXT**: repository, base commit, issue, summary — issue &
summary carry the label `UNFROZEN CONTEXT` with tooltip "Helpful
context only. It does not determine whether Tier 1 is earned."

**D1 RULING**: bug description lives in `experiment-notes.json`
(issue_url, summary, payer_quote), explicitly `UNFROZEN — NOT PART OF
CONTRACT`. The UE schema is NOT changed.

**"What must be true"** (F1 core, human words, no backend field names):
bug reproducible / baseline healthy / only approved files may change /
protected files cannot change / no dependency changes / max patch size /
repeat verification N / network disabled.

**Preflight and Freeze are SEPARATE — mandatory flow:**

```text
CONFIGURE → CHECK ELIGIBILITY → READY TO FREEZE → PAYER REVIEW → FREEZE
```

Button 1: "Check eligibility" (runs base materialization, install, base
regression, baseline health, network sandbox…). Result: ELIGIBLE FOR
FREEZE or NOT ELIGIBLE. **No payer precommit exists yet at this stage.**
The Ready-to-Freeze view shows proven facts (✓ regression red on frozen
base ✓ baseline green ✓ network sandbox verified ✓ dependencies
reconstruct), then the final rules.

**The Pre-commit moment** (single large card, "Before you freeze"):
> If the assigned worker satisfies the Tier-1 conditions shown above
> and the result is independently replayed, the Tier-1 reward is earned.
> **You cannot later turn that earned Tier-1 amount into discretionary
> review because you dislike the implementation.**

Plus: Tier-1 reward / assigned worker / "N frozen conditions". ONE
checkbox: "I understand that these Tier-1 rules cannot be changed after
freezing." Button: **"Freeze these rules"** — never "Create bounty /
Publish / Launch".

**Freeze success**: phase → FROZEN; "The rules are now locked for this
experiment."; payer/worker/tier1/frozen-at; "View technical details"
disclosure (contract freeze hash, ruleset hash, precommit binding, base
SHA) — collapsed by default.

## 9–11. F2 — Frozen Task (worker)

Title "Fix this". UNFROZEN CONTEXT labeled issue/summary. Reward area:
"Tier 1 — 10 — Earned when the frozen conditions below are satisfied."
Never "Possible reward / Up to / Maintainer approval required".
"You earn Tier 1 when" checklist (human words). Second-most important
sentence: **"These conditions were frozen before you started and cannot
be changed for this experiment."** Technical details (base commit,
suite hash, ruleset hash, contract freeze hash, precommit binding,
verifier release, trust anchor) collapsed by default.

## 12–13. F3 — Submit Work

"Submit your work" / "Submit one patch for this verification run."
Paste unified diff OR choose .patch file. No GitHub OAuth. Preview
shows plain file facts only — the frontend must NOT re-parse policy.
Pre-submit line: **"This exact patch will be verified. It cannot be
replaced after this run starts."** Button: "Submit for verification".

**D3 RULING**: submission writes `worker.patch` into the experiment
directory = the WORK SUBMITTED marker. Operational artifact, NOT frozen
contract; the run record later hash-binds its bytes. No new schema.

## 14–17. F4 — Verification (two stages, never EARNED first)

**Stage A "Primary verification"** — rows: Frozen base Verified /
Regression on base Red / Patch scope Pass / Dependency policy Pass /
Regression after patch Green / Existing suite Green / Determinism N/N →
"PRIMARY VERIFICATION PASS". Then, explicitly NOT EARNED yet:
> Primary verification passed. Independent replay is required before
> Tier 1 is considered earned.

**Stage B "Independent replay"** — Rebuilding frozen base / Reapplying
exact patch / Re-running frozen rules / Comparing verdict →
"INDEPENDENT REPLAY PASS". Only then the **Intent moment**: `TIER 1 —
EARNED`, with "This reward has been earned under the rules frozen
before work began." / "Primary verification and independent replay
reached the same Tier-1 verdict." / small print "This is a derived
protocol result. It is not a maintainer approval."

**INVALID** — never "Failed / Worker failed / Bad submission". Heading:
"Tier 1 not earned in this run". Reason + the frozen rule that decided
it. INVALID is TERMINAL for this run: no Retry/Edit/Try-again buttons;
show "This verification run is complete." The OPERATOR decides on a new
attempt/experiment — the frontend must not invent retry semantics.

## 18–23. F5 — Payer Response

Entered only after Tier 1 = EARNED. Machine result pinned on top
(TIER 1 EARNED, primary Pass, replay Pass), then a hard visual
separator: "Now record the payer's response" — above is technical fact,
below is human evidence.

Q1 (no default): "According to the rules you agreed to before work
began, has this worker earned the Tier-1 reward?" Yes → REQUIRE one
verbatim sentence ("In your own words"). No → immediately expand
"Tell us why" (free text — among the most valuable data; never hide it).
Q2: "After seeing the result, do you want to add or change any Tier-1
rule?" No / Yes(+what). Q3: "Would you fund another task using this
structure?" Yes / No / **Answer later**.

**D2 RULING**: "Answer later" writes NOTHING yet (no repeat_fund_intent,
no finalize). If the operator ends the experiment unanswered →
repeat_fund_intent = NOT_ASKED. The frozen enum is NOT widened.

Pre-submit confirmation shows the evidence-class split:
`Technical evidence VERIFIED` / `User evidence OBSERVED / UNSIGNED`
(or `SIGNED_STATEMENT / RECORDED — NOT MACHINE-VERIFIED`). NEVER
"PAYER-ATTESTED", never "verified signature".

**Finalize**: button "Finalize experiment", explicit "The final
experiment ledger can only be created once." → FINALIZED screen with
technical result / payer response / post-hoc rule change 0|N / repeat
funding / conclusion (THESIS STRENGTHENED | MIXED | CHALLENGED), and
the mandatory line: **"One experiment is not evidence of
product-market fit."**

## 24. State machine (final)

```text
DRAFT → CHECKING → READY_TO_FREEZE → FROZEN → SUBMITTED → VERIFYING
      → AWAITING_PAYER → FINALIZED
```

CHECKING and VERIFYING are TRANSIENT orchestrator states; every other
phase derives from disk facts. Persistent facts computed independently:

```text
rules_state            DRAFT | FROZEN
submission_state       NONE | SUBMITTED
primary_verification   PENDING | VALID | INVALID
replay                 PENDING | PASS | FAIL
tier1_entitlement      PENDING | EARNED | NOT_EARNED
payer_response         NONE | RECORDED
ledger                 OPEN | FINALIZED
```

Core derivation (frontend has no authority to override):
`tier1_entitlement = EARNED IFF primary_verification = VALID AND
replay = PASS`.

## 25–28. Rulings & architecture

```text
D1 = experiment-notes.json / UNFROZEN CONTEXT / PASS
D2 = "Answer later" → no ledger mutation yet / no amendment / PASS
D3 = worker.patch marker / operational / run-record binds bytes / PASS
ARCHITECTURE = LOCAL ORCHESTRATOR (frozen)
```

Rationale: Experiment-001 must observe the maintainer's REAL
interactions (freeze / submit / see earned / respond). Operator-run
CLIs would measure protocol usability for ourselves, not product
usability for the maintainer.

Orchestrator lives at `apps/experiment-ui` in two layers:
`apps/experiment-ui/server` + `apps/experiment-ui/web`. Server may ONLY:
CALL freeze / run / proof / replay / ledger; READ artifacts. FORBIDDEN:
reimplementing rules, recomputing entitlement, rewriting the verifier,
maintaining a second state database. Every final state shown on a page
must derive from artifacts.

Product mode: **Facilitated Experiment** — single machine, single
operator, no accounts, no authentication, declared identities, real
maintainer, real external worker. Persistent footer:
`Experiment mode — Facilitated · identities are declared, not
authenticated`.

## 29–32. Visual language: Quiet Authority

Serious, calm, contractual, precise, human-readable. NOT Web3 /
cyberpunk / trading terminal / GitHub clone / SaaS-blue dashboard.
Color SEMANTICS (hex values are implementation detail): Neutral =
information · Frozen = cool/sealed · Pending = muted · Earned = the
strongest positive (full-strength ONLY at the EARNED moment) · Invalid
= restrained warning, not destructive drama · Discretionary/human
evidence = separate warm-neutral category. Typography: human layer =
clean sans-serif; evidence layer = monospace (hashes/SHAs never in the
human layer). Cards: exactly four kinds — Fact / Frozen / Outcome /
Evidence. Components (first version, no big design system):
AppShell, ExperimentHeader, PhaseIndicator, FactBadge, FrozenRulesCard,
RewardCard, EligibilityCheckList, EntitlementSummary, EvidenceRow,
ReplayProgress, TechnicalDetailsDisclosure, PatchSubmission,
PayerQuestion, VerbatimCapture, FinalizePanel.

## 33–34. Red lines

Never render (no such capability exists): Paid / Payment complete /
Funds released / Escrow released / Verified payer / Verified worker /
Tier-2 approved/rejected / Auto release / Dispute resolved.
Wording substitutions (uniform): "Approved" → **Earned**; "Maintainer
accepted the work" → **Tier-1 conditions satisfied**; "The payer
verified…" → **The payer response was recorded**.

## 35–36. Implementation order & per-cut gates

```text
FR-1  AppShell + Experiment status derivation
FR-2  F1 Prepare / Eligibility / Freeze
FR-3  F2 Frozen Task
FR-4  F3 Submit
FR-5  F4 Verification + EARNED moment
FR-6  F5 Payer Response + Finalize
```

Gates: FR-1 no duplicated backend truth / phase derives from artifacts /
transients explicitly separated. FR-2 payer + assigned worker visible /
preflight BEFORE precommit / freeze only after explicit payer action /
unfrozen context visibly labeled. FR-3 worker understands exactly how
Tier 1 is earned / hashes hidden by default / single claimant explicit.
FR-4 exact patch submission / no frontend policy reimplementation /
worker.patch persists before run. FR-5 runner VALID alone never renders
EARNED / EARNED iff independent replay PASS / INVALID maps to the failed
frozen condition. FR-6 machine vs human evidence visually separated /
verbatim capture mandatory / Answer-later does not mutate the enum /
final ledger created once / SIGNED never rendered as machine-verified.

## 37. Success criteria

Not "looks polished". A maintainer who has never heard of Intent can
answer: 1) What did I just freeze? 2) What power do I still have?
3) What must the worker satisfy to earn Tier 1? 4) Why does the system
say this outcome is Earned? 5) Am I confirming a machine fact, or
expressing my own opinion? If ANY of the five is unclear:
`FRONTEND-R1 = NOT PASS`.

## 38. Final state

```text
PRODUCT-UX-R0 = PASS / FROZEN · D1/D2/D3 = PASS
ARCHITECTURE  = LOCAL ORCHESTRATOR / FROZEN
INTERACTION MODEL = PASS / FROZEN
VISUAL LANGUAGE = QUIET AUTHORITY / FROZEN
FRONTEND-R1 IMPLEMENTATION = GO · FIRST CUT = FR-1 + FR-2
PROTOCOL EXPANSION = HOLD
EXPERIMENT-001 = WAITING FOR FRONTEND-R1 MINIMUM FLOW
```
