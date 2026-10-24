# EXPERIMENT-001 — Candidate Shortlist & Screening Record

Status: **ROUND 3 CLOSED — TARGET CLOSED (Commander adjudication 2026-10-23).
RECRUITMENT-STAGE USER SIGNAL: 1 meaningful negative.** EXPERIMENT-001 =
NOT STARTED; REAL PAYER / TASK / WORKER = 0 / 0 / 0. Next recruitment
round targets people with a real moving-goalposts pain (P1 ICP line:
AI-coding/agent teams, outsourcing buyers, result-based commercial
teams) — OSS hobby maintainers are DEMOTED (two signals: payer-role
refusal at zero cost; mechanism refusal at zero cost). Commander ruling:
NEXT ENGINEERING = NONE.

```text
ROUND-3 REPLY RECORD (verbatim, comment id 6364519166)
  who       remcoder
  when      2026-10-23T12:08:20Z (fourth comment on #530)
  verbatim  "I'm interested in getting the bug fixed. The issue desc is
             the requirements. I will eval your solution and report. No
             rewards are needed but i will congratulate you on a good
             solution."
  class     RESPONDED · sponsored terms SEEN · PRE-COMMIT AGREEMENT = NO
            · FROZEN-CONTRACT PARTICIPATION = NOT ACCEPTED
  counter   "issue description = requirements" + maintainer discretionary
            evaluation ("I will eval") — the traditional WORK → EVALUATE →
            DECIDE model, not FREEZE → WORK → PROOF → EARNED
  weight    HIGHER than the round-1 refusal: every participation cost was
            already removed (no payment, no install, no signatures, we
            supply the contributor, sponsor funds the reward) — and the
            mechanism itself was still not chosen over discretionary eval
  ruled     NOT "mechanism disproven" (the experiment never ran); recorded
            as RECRUITMENT-STAGE NEGATIVE SIGNAL. gcode-preview #530 =
            CLOSED for EXPERIMENT-001. NO third contact.
```

Status: **RECRUITMENT ROUND 1 CLOSED — REFUSED (maintainer side).**
Recorded 2026-10-22 (reply arrived 2026-10-03T13:54:49Z, 8 minutes after
first contact; discovered during the 2026-10-22 full-system audit — the
gap in registration is an operator miss, now corrected). Real payer
remains 0; the experiment has not run; worker candidates remain parked
(uncontacted). A next recruitment round is a Commander decision, not an
operator action (same-round shopping is forbidden by charter).

```text
REFUSAL RECORD (recruitment-stage, verbatim)
  who       remcoder (gcode-preview owner) — the first-contact target
  when      2026-10-03T13:54:49Z, in reply to issuecomment-5969774088
  verbatim  "We don't pay for contributions. This is a hobby project.
             Non-commercial."
  class     RECRUITMENT-STAGE REFUSAL of the payer role
  NOT       a payer observation of any completed task; NOT evidence
             against the thesis (the thesis concerns post-delivery
             acceptance under pre-agreed rules; this is a pre-agreement
             funding refusal); NOT a reason to shop within this round
  reading   refusal grounded in a non-commercial project stance
             ("hobby project"), i.e. a pre-filterable property — any
             next round should pre-screen candidate repos for paid-work
             signals (existing bounty programs, sponsorships) before
             first contact. Learning recorded for adjudication; applying
             it (new target list) requires a Commander GO.
```

Commander ruling (awaiting-reply period): if the reward ends up sponsored
by us with the maintainer only validating, that is a DIFFERENT experiment
relationship and requires SEPARATE adjudication before any freeze —
evidence conclusions from the "maintainer as payer" framing do NOT carry
over to it. Frontend stays FROZEN during the wait (no expansion work).

```text
SENT RECORD
  channel   public issue comment (remcoder's own issue, he is watch-author)
  author    xqw1377-prog (Commander's account, keychain credential,
            used on direct order; token never printed/stored by ZCode)
  comment   https://github.com/xyz-tools/gcode-preview/issues/530#issuecomment-5969774088
  comment_id 5969774088
  created   2026-10-03T13:47:01Z
  text      byte-identical to the FINAL draft below (committed aa7d659
            BEFORE sending; draft preceded the act, record follows it)
  next      reply → PREP with maintainer · explicit refusal → verbatim
            recruitment evidence · no reply → UNANSWERED (never refusal)
```
Operator: ZCode. Sending channel: the Commander's stored GitHub credential
(keychain PAT, login xqw1377-prog, verified read-only 2026-10-03) — used
only on the Commander's direct order to send.

## Commander rulings applied before first contact (2026-10-03)

1. **The frozen red test freezes BEHAVIOR, not a fix shape.** Contract:
   "after dispose(), a drop must not process the file or resurrect the
   preview." A behavior-level red test was written against the REAL
   GCodePreview class (renderer-smoke mock pattern, no WebGL) and verified
   RED inside the frozen sandbox: `processGCodeStream` is called once on a
   post-dispose drop; an `update` event fires; the lazy `sceneManager`
   getter rebuilds a renderer. The earlier screening draft (cleanup-return
   contract, fix option 1) is SUPERSEDED — kept only as a screening
   artifact, never to be frozen. Artifacts: /tmp (disposable); the FROZEN
   test is written with the maintainer at PREP.
2. **Funder consistency.** Tier-1 amount, actual funder, and
   `payer_identity` must agree. If the experiment sponsors the reward and
   the maintainer only validates, that is a DIFFERENT relationship than
   the one under test and will be recorded as exactly what it is — never
   mixed. Settled with the maintainer at PREP, before freeze.
3. **"Sign off" wording.** First contact asks the maintainer to READ the
   rules and REPLY that they agree — plain reply, no implication of
   identity authentication or digital signature (R1 provides none).

Recording discipline for the recruitment phase: an explicit refusal is
kept VERBATIM as recruitment-stage evidence; no reply is recorded as
UNANSWERED — never as refusal. Neither may be recorded as a payer
observation of a completed task.

Charter: docs/experiments/EXPERIMENT-001.md · screening checklist:
docs/experiments/EXPERIMENT-001-OPS.md §2. All screening below was run on
2026-10-03 against public data and local clones in /tmp (outside this repo).

## Screening lesson learned first (new hard criterion)

The frozen sandbox (macOS `sandbox-exec '(allow default)(deny network*)')
denies loopback binds, not just outbound. A repo whose EXISTING test suite
spins up `http.createServer` on 127.0.0.1 cannot be GREEN at base inside
the sandbox → INELIGIBLE regardless of how good the bug is. Build-with-ai
was eliminated exactly this way (EPERM below). The checklist line "no
network-dependent tests" is hereby understood to include loopback.

## Candidates examined (7 repos, chronological)

| Repo / task | Verdict | Evidence |
|---|---|---|
| **xyz-tools/gcode-preview #530** (primary) | **ELIGIBLE — pending maintainer + worker** | see §Primary |
| xyz-tools/gcode-preview #477 (secondary) | RESERVE | Cura layer-Z chunk-boundary parser bug (real, open, collab-filed, 2 comments); fix = make parser lookahead resumable — more design latitude than #530, and interacts with parser-rewrite PR #487. Hold as backup only. |
| xyz-tools/gcode-preview #504 | INELIGIBLE | PR #507 (fix by remcoder) already open — task not free for an external worker. |
| PicadoLabs/build-with-ai #82 / #83 | INELIGIBLE | Both bugs real & red-writable (#82 prototype pollution reproduced RED at 1d7aa0a; #83 query-string id corruption confirmed in code). BUT existing suite runs two loopback HTTP servers → `listen EPERM` inside the frozen sandbox → baseline cannot be GREEN. Hard out per charter. |
| tanish19078/robit #7 | INELIGIBLE | No package-lock.json (install-authority ruling: npm+lockfile required). |
| 12rambau/earthengine-extension #194/#198 | INELIGIBLE | VSCode extension; tests download VSCode → network-dependent test env. |
| techcsispit/event-board #1 | WEAK — park | `node --test` suite is empty (vacuous green), 0-star undifferentiated repo; poor payer target. |
| plotly/plotly.js #8100, ToolJet #18146 | PARKED | npm+tests exist but suite weight (minutes × N determinism × patched+baseline+replay) impractical for a facilitated session; ToolJet needs DB/cypress. |

Search provenance: GitHub issue search (bug + "good first issue", JS and
TS passes, sort updated/created), then per-repo verification via the
public API (repo metadata, package.json, package-lock.json presence, issue
state/comments, open-PR collision check), then local screening.

## Primary: xyz-tools/gcode-preview — issue #530

Repo facts (verified 2026-10-03): MIT · 202 stars · default branch
`develop` · pushed 2026-09-30 (HEAD screened: `3dbb236`) · vitest 5 +
happy-dom, NO WebGL needed for dom-utils tests.

Issue #530 "makeDroppable never removes its listeners, so a disposed
preview can be resurrected by a drop" — open, unassigned, 0 comments,
filed by **remcoder** (OWNER/MEMBER) 2026-09-14 with a complete write-up
including two suggested fix shapes. `src/extra/dom-utils.ts` at HEAD
still adds dragover/dragleave/drop listeners with no removal path — bug
present at base.

Checklist results (all inside the frozen net-denied sandbox, local clone):

```text
[x] real OSS repo · real maintainer who answers   — remcoder active same-day
    on #504 comments; 16 open PRs; issue authored by the owner himself
[x] npm + package-lock committed                  — package-lock.json 239,242 B
[x] npm ci --ignore-scripts builds the test env   — verified locally
[x] one real, currently-existing bug              — #530 unfixed at 3dbb236
[x] regression test RED at pinned base            — screening draft fails:
    drop-after-cleanup still calls clear()/processGCodeStream()
[x] existing suite GREEN at pinned base           — 44 files / 980 tests pass
[x] deterministic                                 — 3/3 identical (1 red | 980
    green, ~4 s per full run)
[x] small fix scope                               — src/extra/dom-utils.ts (+
    dispose wiring in src/gcode-preview.ts); allowed_paths ⊂ src/**;
    tests/lockfile/CI protected for the worker
[x] no symlink changes · no new dependencies · no external APIs ·
    no network-dependent tests (sandbox-proven) · no DB/infra
[x] expected patch small and unambiguous          — the maintainer's own
    issue proposes the fix; boring by construction
[ ] reward: Tier-1 symbolic/testnet amount        — to be set with the
    maintainer at PREP (Tier-2 = 0 for this experiment)
[ ] worker pre-designated BEFORE freeze, external, unaffiliated  — OPEN
```

Screening artifacts (in /tmp, disposable): a fix-shape screening test
(cleanup-return, option 1) and the ruled behavior-level test (real class,
post-dispose drop) — both verified RED at base inside the frozen sandbox;
the clone restored to 44 files / 980 tests green afterwards. The FROZEN
acceptance test is written WITH the maintainer at PREP and encodes the
behavior contract only (ruling 1).

## First-contact message (remcoder, via #530) — FINAL, applies all rulings

Follows the frozen template (experiment first; no protocol, no
blockchain, no proof architecture, no product pitch; one qualifying
question; refusal = data) plus rulings 1–3:

> Hi Remcoder — I'm helping run a small, facilitated experiment about
> pre-agreed standards in open-source work, and gcode-preview looks like
> a great fit.
>
> You have a real, still-open bug: #530 — makeDroppable never removes
> its listeners, so a disposed preview can be resurrected by a drop
> (your own write-up).
>
> Before anyone touches it, we would freeze — with you — exactly what
> counts as fixed: a new test, written together with you, that describes
> the required behavior (after dispose(), a drop must do nothing — not
> any particular implementation), which files may change, and how big
> the patch may be. An external contributor then does the fix. A
> separate machine re-runs everything from the frozen baseline,
> offline, from your package-lock.
>
> The reward is a small symbolic amount, pre-money by design. Who
> actually funds it is agreed and recorded exactly as it is before
> anything is frozen — the payer is never blurred.
>
> The one thing we're testing: if the pre-agreed conditions are all
> satisfied, will you acknowledge that the fixed reward for that part
> has been earned — rather than redefining the standard afterwards?
>
> Would you be willing to read the rules and reply here that you agree
> to them — before seeing the solution? (A plain reply is all "agree"
> means here — no signatures, no accounts, nothing to install.)

If the answer is "no": keep the refusal verbatim as recruitment-stage
evidence; do NOT shop for a friendlier maintainer in the same round. If
there is no reply: record UNANSWERED — never refusal (ruling above).

## Recruitment Round 2 (2026-10-22) — Commander order "全部解决好": COMPLETED, NO ELIGIBLE CANDIDATE, NOTHING SENT

Pre-screen added per the round-1 lesson (remcoder: "We don't pay" —
hobby/non-commercial): candidate repos must show PAID-WORK signals
(active bounty program, paid history). Searched: label/title "bounty"
(JS+TS), Algora label, Algora mentions, Opire label, closed-bounty
(paid-history) pass. Every hit eliminated with evidence:

| Repo / task | Verdict | Evidence |
|---|---|---|
| copperheadhq/copperhead #301 (skill compat settings) | INELIGIBLE — sandbox baseline RED | Real $ bounty culture ($50, paid-on-merge, Discord-tracked); npm+lockfile; bug real at 476cc15, no PR collision. BUT full suite inside the frozen net-denied sandbox: **22 files / 53 tests FAILED** (provider tests spin loopback HTTP servers) → charter "baseline GREEN in sandbox" impossible. |
| paraspell/xcm-tools #2176 (ED subtracted twice) | INELIGIBLE — pnpm + fix in flight | Root package.json = pnpm/turbo monorepo (pnpm-lock.yaml; no package-lock) → install-authority ruling; fix PR #2182 open + contested by two claimants. |
| tscircuit/core (Algora flagship payer) | INELIGIBLE — bun | bun scripts, no npm lockfile. #3927 additionally fix-in-archived-dep (murky task boundary). |
| FreezingMoon/AncientBeast | INELIGIBLE — bun | engines/packageManager bun@1.4.2. |
| Mantitup-Org/vista #62 | INELIGIBLE — scope | "Hunt and fix remaining deployment bugs" across hosts = open-ended, not small/unambiguous. |
| ritik4ever/stellar-bounty-board #1198/#1199 | INELIGIBLE — supertest loopback | backend tests import supertest (binds loopback) → sandbox EPERM, same class as build-with-ai. |
| picsoritdidnthappen/poidh-app (real crypto payouts) | INELIGIBLE — no npm lockfile | default branch `prod`, jest, no package-lock (any branch checked). |
| lambdaclass/stabileo, arakoodev/EdgeChains, others | OUT | Rust-side bounty pool; EdgeChains bounties are network-integration tasks (AWS Comprehend/qdrant) — charter bans external-API scope. |

### Structural finding (round 2) — RECLASSIFIED as PRODUCT EVIDENCE by DIRECTION-R1 (2026-10-22)

The eligible-payer intersection {npm+package-lock ∧ offline-pure FULL
suite ∧ real payer culture ∧ small boring open bug ∧ no in-flight fix}
came up EMPTY in the searched pool. **Commander ruling: this is not an
operations shortfall — it is product evidence.** Repos with pay culture
run large/complex/server/network-bound/pnpm-bun shapes that fail the R0
machine's conditions; tech-clean repos skew hobby/non-commercial whose
maintainers decline the payer role. Consequence (DIRECTION-R1): OSS
bounty is demoted from FIRST MARKET to FIRST LAB; the ICP is re-opened
for P1 interviews (docs/product/ICP-INTERVIEW-KIT.md). Measured pattern
kept for the record: copperhead = 22 sandbox-red files (loopback
suites); gcode-preview passed tech screening because it is a pure
rendering library — and its maintainer refused the PAYER role, not the
tech.

### Decision point for the Commander (paths, no action taken)

1. **Sponsor-funded relationship** — per the standing ruling, if WE fund
   the symbolic Tier-1 and the maintainer only validates, the
   experiment relationship needs SEPARATE adjudication first. If
   adjudicated, the candidate pool reopens to every tech-eligible repo
   (gcode-preview-class pure libraries), and even gcode-preview's
   refusal ("WE don't pay") dissolves — though re-contacting the same
   maintainer under new terms spends a second one-shot and should be
   weighed. Requires explicit Commander ruling; not self-executed.
2. **Extended hunting** — another search round on order (Algora-listed
   npm projects, Opire without language filter, paid-history mining).
3. **Hold recruitment** until the Commander defines direction.

Worker side: 3 screened candidates remain parked/uncontacted (they are
engaged only after a payer exists).

## Recruitment Round 3 (2026-10-22) — SPONSORED-RELATIONSHIP, Commander path 1 ordered

Status: **SECOND CONTACT SENT 2026-10-22T09:02:21Z — awaiting reply
(UNANSWERED).**

```text
SENT RECORD (round 3)
  amendment EXPERIMENT-001-AMENDMENT-1 committed c725c1d BEFORE the
            send (draft preceded act, record follows)
  comment   https://github.com/xyz-tools/gcode-preview/issues/530#issuecomment-6336937290
  comment_id 6336937290
  author    xqw1377-prog (Commander account, keychain credential,
            direct order path)
  created   2026-10-22T09:02:21Z
  text      byte-identical to the second-contact draft below
  terms     SPONSORED-RELATIONSHIP per AMENDMENT-1 (maintainer never
            pays; F5 = acknowledgment evidence only)
  next      agree → PREP per frozen runbook · refuse again → verbatim
            record + gcode-preview CLOSED for this experiment (two
            refusals = final) · no reply → UNANSWERED
```

EXPERIMENT-001-AMENDMENT-1 ratified (docs/AMENDMENTS.md): sponsor-funded
symbolic Tier-1, maintainer = rule-co-author + acceptor, F5 answer =
ACKNOWLEDGMENT evidence (never citable as payer/payment evidence);
"REAL PAYER 0→1" not converted by sponsored runs.

Target: **gcode-preview #530 re-approach** — re-verified 2026-10-22
before contact: issue still open, no comments since the refusal,
`src/extra/dom-utils.ts` at develop HEAD still has no listener-cleanup
path (bug unfixed). Rationale: the only repo that passed the FULL
technical screen (sandbox-verified red test, 980-green offline suite,
3/3 determinism), a demonstrably responsive maintainer, and the
round-1 refusal reason ("we don't pay") is exactly what the new terms
remove. The terms change is stated up front, per the amendment.

### Second-contact message (remcoder, #530) — acknowledging the refusal, new terms

> Hi Remcoder — following up on #530, and thank you for the straight
> answer: you don't pay for contributions, this is a hobby project,
> non-commercial. Understood — and that's on us for burying the lead.
>
> We've restructured the experiment so that question is gone: the
> reward is funded entirely by us (a small symbolic amount). You would
> never pay anything, now or later.
>
> What we'd still love to test with you, if you're willing:
>
> 1. Before anyone touches the bug, we freeze — with you — exactly what
>    counts as fixed: a behavior-level test written together (after
>    dispose(), a drop must do nothing — not any particular
>    implementation), which files may change, how big the patch may be.
> 2. An external contributor fixes it. A separate machine re-runs
>    everything from the frozen baseline, offline, from your
>    package-lock.
> 3. Then one question to you, before any authorship or preferences are
>    shown: per the rules you agreed to in advance, has this fix earned
>    the reward?
>
> That's the whole experiment: whether pre-agreed rules hold their
> shape after the outcome is known. Would you take part on those terms?
> (A plain reply is all it takes — no signatures, no accounts, nothing
> to install.)

If refused again: record verbatim; gcode-preview is then CLOSED for
this experiment (two refusals = final). If agreed: PREP per the frozen
runbook (maintainer co-authors the frozen behavior test → identities
declared → F1 real preflight → Review → Freeze → worker engaged → F4
two-stage verification → F5 acknowledgment under the sponsored framing).

## Worker-candidate shortlist (2026-10-03, parked) — NONE CONTACTED

Commander order: find one external worker (TS-capable, accepts frozen
standards, unaffiliated with the maintainer); confirm willingness first;
no task details, no solution shown, no work before freeze. Pool source:
external authors of recent TypeScript PRs (2026-09-25+), then per-person
profile + affiliation screening.

| Rank | Candidate | Evidence | gcode-preview affiliation | Contact channel |
|---|---|---|---|---|
| 1 | **bkdev98** (Quoc Khanh, VN) | 10-yr GitHub, 71 repos, 76 followers, web/mobile TS, ships today (critterpass #581); site states "open to new opportunities or freelance" | ZERO (issue/PR search empty) | quocs.com/contact form (no public email) |
| 2 | **ChristopherZhong** (PhD CS) | active today (config-lens #60 — schema-validation tooling); self-described test-driven practices — philosophically aligned with frozen acceptance; hireable: true | ZERO | LinkedIn (christopherzhong); site has no email |
| 3 | **elmaxe** (Axel Elmarsson, SE) | employed dev @BookBeat, active today (sporer #91); playful bio | ZERO | LinkedIn only |

Selection note: rank 1 = cleanest combination of proven TS + motivation
signal + reachable form; rank 2 = best philosophical fit, channel requires
the Commander's LinkedIn; rank 3 = spare. ONE candidate is approached at
a time (single-claimant discipline; no parallel canvassing).

### Worker first-contact message (template, per-candidate greeting)

Template discipline: experiment first; no protocol, no blockchain, no
product pitch; no task details or solution; willingness question only;
symbolic reward stated up front; work starts only after freeze (F2).

> Subject: One small TypeScript fix — rules frozen before you start
> (small paid experiment)
>
> Hi [name],
>
> I'm running a small, facilitated experiment about pre-agreed standards
> in open-source work, and I'm looking for exactly one external
> contributor.
>
> The shape: a small, real bug fix (TypeScript, likely a few lines) in an
> active open-source repository. Before you write anything, the acceptance
> rules are frozen and shown to you: which test must go from red to green,
> which files may change, how big the patch may be. You submit one patch.
> A separate machine re-runs everything from the frozen baseline — the bar
> cannot be moved afterwards, in either direction. That immovability is
> exactly what the experiment is about.
>
> Right now I'm only asking: would you be willing to take such a task
> under those conditions? The reward is a small symbolic amount, agreed
> and written down before you start. If yes, I'll come back with the
> frozen task (repo, bug, exact rules) as soon as the rules are locked —
> not before.
>
> — [Commander]

Sending: via the Commander's own channel (contact form / LinkedIn /
mailbox). ZCode holds no worker-side channel and none is needed — the
worker's declared identity binds at ClaimRecord time (facilitated mode,
no authentication claimed or implied).

## Open items before Freeze (per Commander order)

1. ~~Send the first contact~~ DONE 2026-10-03T13:47:01Z (see SENT RECORD).
2. Worker: shortlist above (3 candidates, affiliation-cleared, NONE
   CONTACTED). Commander picks one and sends the template via personal
   channel; willingness confirmed before PREP completes.
3. Funding: per Commander — prefer asking the maintainer to act as the
   ACTUAL payer of a small Tier-1 reward once they reply; if we sponsor
   instead, the experiment relationship gets a SEPARATE adjudication
   before freeze (already registered).
4. PREP (only when explicit agreement + actual payer + external worker
   are ALL secured): pin base commit, write the frozen behavior-level
   acceptance test with the maintainer (red at base), set the Tier-1
   amount, confirm identities → F1 real preflight → Review → Freeze →
   only then the worker starts.
