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

---

# REVISION 2 — HOLD-6 interaction contract (supersedes conflicting text above)

Status: **D4–D9 and P1 rulings incorporated (Commander, 2026-10-03).
PRODUCT-UX-R0 = PASS / interaction spec FROZEN. FRONTEND-R1
implementation executable WITHIN this contract; implementation
correctness still to be evidenced. No visual-design work in this
revision.**

This revision changes THIS SPEC ONLY. UE-0..UE-5 code, schemas, enums,
trust anchors, payment authority, and frozen artifacts are unchanged.
Earlier text above conflicting with this revision is superseded.

## Scope and operating mode

Facilitated local experiment — NOT self-service SaaS. One operator runs
the local Node service and facilitates one real maintainer and one real
external worker, both selected BEFORE freeze. Identities are declared
experiment identities; no authentication exists in R1;
maintainer/worker/observer labels are not authenticated accounts;
browser clicks are observed input, never proof of clicker identity or a
verified signature. Pre-money/testnet value only; real funds, chain
writes, auto-release, marketplace, accounts, wallets, concurrent
claims, retry contracts, Tier-2 engine and arbitration remain HOLD.
EXPERIMENT-001 uses Tier-1 only: `tier2_reward = "0"`, shown as "Tier
2 — not used in this experiment". EARNED means Tier-1 entitlement under
the frozen experiment rules — never sent payment, escrow,
auto-settlement, authenticated consent, or legal effect.

## Principles

Protocol state → human-understandable entitlement state. First
experiment language: frozen rules → verified outcome → Tier-1
ENTITLEMENT EARNED. "Still discretionary" is broader-thesis language,
NOT an operable review control in R1; for a non-zero-tier2 task show
"Tier-2 reward is declared only; not evaluated or settled in this
experiment" and NEVER "What you still control: Tier-2 review only".
Every frozen/verified/earned claim must trace to a frozen artifact or
machine report. experiment-notes.json stays UNFROZEN CONTEXT. Never
rebuild verifier/policy/hash/entitlement logic in the frontend; hashes,
proofs and verifier internals stay collapsed under Technical details.

## F1 — Prepare & Freeze (D4, D5)

WHO: payer_identity, assigned worker_identity, SINGLE_CLAIMANT visible;
"this task is frozen for this worker only". Both participants must be
selected before preparation; empty identities BLOCK prepare and freeze.
WHAT: repository URL, exact base commit, bug context (unfrozen),
declared Tier-1 amount, Tier-2 = 0. Declared amounts are experimental
only — no invented currency, conversion, or payment mechanics.
WHAT MUST BE TRUE: regression + baseline commands, suite/lockfile
identities, allowed/forbidden paths, no dependency changes, diff bound,
N determinism runs, network denial — labeled as RULES (requirements),
not as completed checks.

Step 1 — Prepare and check: call the existing `runPreflight(repoDir,
cfg)` WITHOUT publishing a freeze pack. Before success, checks are
PENDING — never fake green ticks. On success show: base red · baseline
green · network denied · install succeeded · not reproducible
(不可重现). Source: returned suiteHash/lockHash and preflight fields.
These are PREPARE evidence, not a frozen checklist. Network-denial
describes the verification-sandbox commands, NOT a claim that
dependency install never used the network.

Server-side snapshot: retain the reviewed input snapshot and machine
report. ANY change to identity, reward, base, commands, suite,
lockfile, scope, or other reviewed contract inputs INVALIDATES
readiness → re-prepare and re-check required. Readiness never
reconstructs from browser memory. A restart must never infer a running
process from missing outputs — show interrupted/incomplete and require
operator action. Failed prepare leaves DRAFT and publishes nothing.

Step 2 — Review and finalize: show the COMPLETE entitlement terms, not
a short checklist — identities, amounts, claim mode, all
rules/commands, and the full pre-commit text. "Everything below has
been checked. If you freeze now, satisfying these rules creates an
irreversible Tier-1 entitlement." Conditions explicitly include BOTH
primary verification AND independent portable replay. Button: FREEZE
THESE RULES. The exact payer_precommit_text and UTC
payer_precommit_timestamp are captured only on explicit agreement; the
operator records this as OBSERVED consent (not authenticated, not
cryptographically verified). Call freezeExperiment() with the REVIEWED
snapshot — it re-runs preflight and publishes atomically. Compare the
published suite/lockfile identities and terms against the reviewed
ones; ANY mismatch blocks the UI's frozen claim and requires operator
inspection/re-review — never silently present changed terms as agreed.
Never modify frozen modules to skip their second preflight. Disable
duplicate freeze requests. Show recheck/publish status until
complete; only a complete verified 4-file generation is frozen. No
work starts before a successful freeze.

## F2 — Frozen Task

"The rules of this task can no longer be changed." Assigned worker,
bug context [UNFROZEN CONTEXT], declared Tier-1 reward. "You earn the
reward when: the bug is fixed; existing tests stay green; only allowed
files change; dependencies stay unchanged; deterministic verification
and independent replay both succeed." All requirements are projections
of frozen task/ruleset data — the copy must not introduce extra
criteria. Tier 2: not used in this experiment. Frozen-task download
available; collapsed technical details include hashes, precommit
binding, commands, and the EXPERIMENT-001 trust anchor. A missing or
inconsistent freeze generation is an evidence error, not a frozen
task. Precommit semantics: changing committed terms invalidates the
binding.

## F3 — Submit Work (P1)

Choose/paste ONE unified diff — a local draft input, not a commitment.
Show filename and byte size only; do NOT invent line/file counts and
do NOT re-run the policy parser. "This exact patch will be verified.
It cannot be replaced after submission for this run." Button: SUBMIT
FOR VERIFICATION. The operator service places the exact bytes as
`worker.patch` (the submission marker) OUTSIDE the 4-file freeze
generation. Written ONCE; duplicate/concurrent submissions cannot
overwrite. The runner later hash-binds those bytes. Then the existing
UE-2 runner is called. After submission: "immutable for this run".
INVALID is terminal for this submission — no retry and no patch
replacement in R1; a new attempt requires operator action / a new
experiment. An interrupted process is NOT an INVALID: keep the
submitted bytes and require operator inspection.

## F4 — Verification Result (D6)

Two distinct stages: PRIMARY VERIFICATION (UE-2) and INDEPENDENT
REPLAY (the trusted portable UE-4 verifier over the UE-3 pack). Flow:
patch submitted → primary verification → independent replay → earned.
A UE-2 VALID is CANDIDATE-valid and can never earn by itself: validate
the DERIVED checks and bindings with the frozen proof/ledger
verification boundaries — a raw verdict string is not sufficient.
Before executing, the independent replay checks the trusted verifier's
identity against EXPERIMENT-001's externally published anchor. A
locally-generated replay process does not prove real third-party
participation — the operator facilitates the replay EXPERIMENT-001
requires, and the UI distinguishes machine-replay success from
observed third-party participation.

EARNED is rendered ONLY when: primary result VALID (derived+bound) AND
independent replay PASS with fresh binding to the CURRENT frozen/
patch/proof pack (manifest hash + pack-bytes digest freshness).
Missing, stale, mismatched, untrusted, or failed evidence NEVER
renders EARNED — including intermediate render frames. The replay
report is NOT placed inside the 9-file proof pack (it stays a
sidecar). After both PASS, show exactly: `TIER 1 — EARNED` /
"This is a derived result under rules frozen before work began."

Facts stay independent: a later payer "No" cannot change the machine
result. Primary INVALID: show the machine rule that failed; no
entitlement proof pack and no UE-5 entry. Replay FAIL: primary may
stand but entitlement remains unverified — show the failure and
require operator action, no auto-retry. Missing report / interrupted
process: verification incomplete — never a fabricated failure or
pass. No optimistic-earned rendering while replay is pending.

Human row → evidence source: Frozen base ← freeze closure +
suite/lockfile checks; Regression fixed ← patched acceptance green +
base regression red; Existing suite ← patched baseline green; Allowed
scope ← policy result OK; Dependencies ← dependency policy OK;
Determinism ← full N/N; Primary result ← DERIVED UE-2 record;
Independent replay ← trusted UE-4 report, same verdict, current pack
binding; Earned ← the combination above, derived via the frozen
verifier; Technical details / download ← the 9-file proof pack +
trusted-verifier instructions.

## F5 — Record Payer Response (D9, P1)

Available ONLY on UE-5's verified VALID evidence path. Machine result
(TIER 1 EARNED) stays visible at all times; technical and user
evidence remain separated.

Q1 "According to the rules you agreed to before work began, has this
worker earned the Tier-1 reward?" → payer_accepts_tier1; record
payer_ack_verbatim and observation timestamp. A "No" immediately
prompts "Tell us why" and preserves the payer's verbatim words.
Q2 "After seeing the result, did you attempt to change any Tier-1
rule?" → posthoc_rule_change_attempts (+ one detail per attempt).
Wanting to change rules is EVIDENCE ONLY — it is not permission to
edit the frozen contract.
Q3 "Would you fund another task using this structure?" → Yes / No /
Answer later. Yes/No map to frozen repeat_fund_intent=YES/NO. "Answer
later" keeps an unresolved UI state: it NEVER maps to No and BLOCKS
finalize. The operator may explicitly close an unresolved follow-up
with frozen NOT_ASKED, recording the hesitation verbatim and the
reason the experiment closed without an answer in the source. NOT_ASKED
must not be presented as an explicit No or as evidence the question
was never shown. The frozen enum is NOT widened.

Use LedgerObservationsV1 exactly: observation_source,
observer_identity, source_record, source_record_sha256,
payer_attestation=UNSIGNED_RECORDED. Default label: USER EVIDENCE —
OBSERVED / UNSIGNED. A recorded signed statement: SIGNED_STATEMENT /
RECORDED — NOT MACHINE-VERIFIED. Never "payer-attested", verified
identity, or machine-verified signature. Observations append
immutably; pre-final revisions remain separately recorded. The final
ledger is generated from the latest valid observation and written
once. Unresolved required responses never default silently. The final
ledger records the experiment outcome; it cannot turn a payer No into
acceptance or un-earn Tier 1.

## Phases and independent facts (D7)

Phase is a NAVIGATION HINT, never a substitute for evidence.

```text
DRAFT           inputs incomplete, prepare missing/invalid, or prepare failed
READY TO FREEZE a current prepare report succeeded with a reviewed input snapshot
FROZEN          a complete, verified freeze generation
SUBMITTED       an immutable worker.patch exists for this run
VERIFYING       the orchestrator is CURRENTLY running primary verification or replay
AWAITING PAYER  derived VALID + matching independent replay PASS; UE-5 eligible
FINALIZED       a valid final-ledger.json exists
```

Independent badges persist at every later phase: task = frozen/not;
Tier-1 primary = valid/invalid/pending; replay = pass/fail/pending;
payer response = recorded/not. "Primary valid" must never imply
verified-earned while replay is pending/failed. Terminal INVALID and
replay-fail are outcome/error panels in the submitted flow — no
"awaiting payer" path may be created that UE-5 would reject.
FINALIZED keeps ALL historical badges; no earlier fact ever
disappears. Persistent facts = verified disk artifacts/reports;
transient UI state = orchestrator process state (prepare, publishing,
verifying, replaying). On reload, verify disk facts; on restart never
infer a running process from missing outputs — show interrupted/
incomplete and prompt operator action. File existence alone is NOT
sufficient to claim verification. The canonical final success page
(finalized / rules frozen ✓ / Tier-1 earned / independent proof ✓ /
payer response recorded) renders only when ALL supporting facts
actually exist.

## Local orchestrator integration

Local Node service wrapping the EXISTING frozen modules; one
facilitated experiment; loopback only; no hosting/accounts/auth.
Prepare → runPreflight; explicit consent → freezeExperiment.
Run/verify/replay/ledger call the existing modules/executables —
never copy policy, verifier, or entitlement engines. The portable
verifier stays independent — never substitute the runner for it.
Operational prepare/submission states are NOT new protocol objects.
Authoritative outputs must be byte-identical to the CLI for identical
inputs. Real timestamps remain explicit inputs; never modify frozen
artifacts for normalization. All prepare/test temp writes use OS temp;
operational sidecars/reports live OUTSIDE the exact frozen/proof
generations. Browser controls facilitate participation — they are not
authentication. Show the operating mode and declared-identity
limitation before freeze and at response recording.

## Implementation acceptance contract (machine-evidenced before PASS)

```text
1  Prepare publishes no freeze pack; only explicit reviewed agreement
   freezes; edits invalidate readiness; a failed re-check or mismatch
   can never silently freeze different reviewed terms.
2  Missing payer/assigned-worker blocks freeze; SINGLE_CLAIMANT visible.
3  UE-2 VALID + replay pending/failed/stale/mismatched/untrusted never
   renders EARNED — including intermediate render frames.
4  Bound-matched VALID/PASS produces EARNED; a payer No preserves it
   and records the rejection verbatim.
5  Phase changes keep badges; restart never regenerates a running
   process or completed verification.
6  Tier-2 zero renders unused; a non-zero declared view shows no
   review/settlement control.
7  Declared identities and OBSERVED / UNSIGNED never become
   authenticated/signed claims.
8  Submission is irreplaceable; INVALID outcome has no UI retry;
   verification failure cannot bypass UE-5 eligibility.
9  Answer-later blocks finalize; NOT_ASKED requires explicit operator
   closure + provenance; the frozen enum is unchanged.
10 Frozen module bytes / trust anchor unchanged; artifact outputs
   compatible; repository hygiene passes.
```
