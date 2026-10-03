# PRODUCT-UX-R0 / FRONTEND-R1 — Facilitated Experiment Interaction Contract

Status: **D4–D9 and P1 rulings incorporated (2026-10-03). PRODUCT-UX-R0 = PASS / FROZEN as an interaction specification. FRONTEND-R1 IMPLEMENTATION = GO within this contract; implementation correctness remains NOT VERIFIED. No visual-design work in this cut.**

Authority: the Commander's HOLD-6 review supersedes the previous premature GO and all conflicting wording in this document.
References: PRODUCT-THESIS-R0, USER-EVIDENCE-R0, EXPERIMENT-001.
This cut changes this specification only. UE-0..UE-5 code, schemas, enums, trust anchors, payment authority and frozen artifacts remain unchanged.

## Scope and operating mode

**Facilitated local experiment, not self-service software.**
One operator runs a localhost Node service and facilitates participation by a real maintainer and a real external worker, selected BEFORE freeze.
Identity = declared experiment identity. Authentication = NOT PROVIDED IN R1.
Maintainer / Worker / Observer labels are not authenticated accounts. Browser clicks are observed input, not proof of who clicked or a verified signature.

PRE-MONEY / TESTNET-VALUE ONLY; real funds, chain writes, auto-release, public marketplace, accounts, wallets, concurrent claims, retry contracts, Tier-2 engine and arbitration remain HOLD.
EXPERIMENT-001 uses Tier 1 only: config `tier2_reward = "0"`; display “Tier 2 — not used in this experiment”.
EARNED means the derived Tier-1 entitlement under frozen experiment rules; it does not mean payment sent, custody, automatic settlement, authenticated assent or legal enforceability.

## Product and evidence principles

Translate protocol state into understandable entitlement state.
First-experiment language: FROZEN RULES → VERIFIED OUTCOME → TIER 1 EARNED.
STILL DISCRETIONARY belongs to the broader thesis; it is not an executable review control in R1.
If viewing a different frozen task with nonzero Tier 2, show:
“Tier 2 is declared only. It is not evaluated or settled by this experiment.”
Never show “What you still control: Tier-2 review only”.

Every claim of FROZEN / VERIFIED / EARNED must trace to a frozen artifact or machine report.
Draft inputs and `experiment-notes.json` { issue_url, summary, payer_quote } are permitted, visibly labeled **UNFROZEN CONTEXT — not part of the frozen contract**.
Do not reconstruct verifier, policy, hash or entitlement logic in the frontend.
Hash, proof and verifier internals default to collapsed “Technical details”.

## F1 — Prepare & Freeze (D4, D5)

### WHO

Show PAYER / Maintainer (`payer_identity`), ASSIGNED WORKER (`worker_identity`) and CLAIM MODE (`SINGLE_CLAIMANT`).
“This task is frozen for this worker only.”
Both real participants must be selected before preparation. These strings will be contract-bound, not authenticated.
An empty identity blocks preparation and freeze.

### WHAT

Show repository URL, exact base commit, bug context [UNFROZEN CONTEXT], Tier-1 declared amount and Tier-2 zero.
Amounts are declared experiment terms; do not invent a currency, conversion or payment mechanism.

### WHAT COUNTS

Show regression and baseline commands, suite/lockfile identity, allowed/forbidden paths, no dependency change, diff bound, N deterministic runs and network-denied verification.
Policy requirements are labeled “rules”, not completed checks.

### Step 1 — Prepare & Check

Call the existing exported `runPreflight(repoDir, cfg)` without publishing a freeze pack.
Before success, checks are pending; never render fabricated green ticks.
On success display:
Base RED · Baseline GREEN · Network DENIED · Install OK · N/N reproducible.
Source is the returned `suiteHash`, `lockHash`, `preflight`:
`base_regression=RED`, `baseline_health=GREEN`,
`network_sandbox=DENIED_VERIFIED`,
`dependency_reconstruction=CLEAN_ROOM_OK`, `determinism=N/N`.
These are preparation evidence, not a frozen manifest.
Network DENIED describes verification sandbox commands, not an assertion that dependency installation never uses the network.

Keep a server-side prepared input snapshot and the machine report.
Any change to identity, reward, base, commands, suite, lockfile, scope or other reviewed contract input invalidates readiness and requires Prepare & Check again.
Lost preparation state on service restart requires re-preparation; never recover readiness from browser memory.
Preparation failure leaves DRAFT and no published freeze generation.

### Step 2 — Review & Freeze

Present the COMPLETE entitlement terms, not merely a short checklist. Include identities, amounts, claim mode, all rules/commands and the exact precommit text.
“Everything below has been checked. If you freeze now, satisfying these rules creates an irreversible Tier-1 entitlement.”
“If these conditions are satisfied, Tier 1 is earned.”
The displayed conditions expressly include primary verification AND independent portable replay.

Button: **Freeze these rules**.
Only after explicit agreement capture exact `payer_precommit_text` and UTC `payer_precommit_timestamp`.
The operator records this as observed assent, not authenticated or cryptographically verified assent.
Call `freezeExperiment()` with the reviewed snapshot. It re-runs preflight and atomically publishes.
Compare recheck suite/lockfile identities and terms with what was reviewed; any mismatch blocks the UI's FROZEN claim and requires operator inspection/new review. Never silently present changed terms as agreed.
Do not modify the frozen module to skip its second preflight.
Disable duplicate freeze requests. Display rechecking/publishing until complete.
Only a complete, validated 4-file generation permits FROZEN. Failure cannot advance the page.
No work begins until freeze succeeds.

## F2 — Frozen Task

“These rules can no longer be changed for this task.”
Show assigned worker, bug context [UNFROZEN CONTEXT] and declared Tier-1 reward.
“You earn it when: the bug is fixed; existing tests stay green; only allowed files change; dependencies remain unchanged; deterministic verification and independent replay succeed.”
All requirements are projections of frozen task/ruleset data; copy cannot introduce additional judging criteria.
Tier 2: not used in this experiment.
Expose frozen task download and collapsed Technical details with hashes, precommit binding, commands and EXPERIMENT-001 trust anchors.
A missing or inconsistent freeze generation is an evidence error, not a frozen task.
Precommit semantics: changing a committed term invalidates its binding.

## F3 — Submit Work (P1)

Select/paste one unified diff. Selection is local draft input, not submission.
Show filename and byte size; do not invent changed-line/file counts or duplicate the policy parser.
“This exact patch will be verified. After submission it cannot be replaced in this run.”
Button: **Submit for verification**.
The operator service places exact bytes at `worker.patch` as an operational submission marker, outside the 4-file freeze generation.
Write once; duplicate/concurrent submission cannot overwrite. The runner later hash-binds these bytes.
Then call the existing UE-2 runner.
Display “Immutable for this run” after successful submission.
INVALID is terminal for this submission. No “Try again” or patch replacement.
A new attempt requires operator action / a new experiment, not an invented R0 retry contract.
Process interruption is not INVALID; preserve the submitted bytes and require operator inspection.

## F4 — Verify Outcome (D6)

Two distinct steps:
1. Primary verification — UE-2.
2. Independent replay — trusted portable UE-4 verifier, from the UE-3 pack.

Flow: Checking patch → Primary verification passed → Independently replaying → Replay PASS → TIER 1 EARNED.
UE-2 `VALID` is **CANDIDATE VALID**, never EARNED by itself.
Use existing frozen proof/ledger verification boundaries to validate derived checks and bindings; a raw verdict string alone is insufficient.
Independent replay requires trusted verifier identity checked against EXPERIMENT-001's external release anchor BEFORE execution.
A replay process spawned locally is not proof of a real third party's participation. The operator must facilitate the real independent replay required by EXPERIMENT-001; distinguish machine replay success from observed third-party participation.

**EARNED iff the primary outcome is VALID and independent replay is PASS with the same VALID verdict, bound to this exact current freeze/patch/proof pack.**
Use manifest hash AND pack-byte digest freshness checks; missing, stale, mismatched, untrusted or failed evidence never yields EARNED.
Do not place replay reports inside the exact nine-file proof pack.
Header only after both passes: **TIER 1 — EARNED**.
“This is a derived result from the rules frozen before work began.”

Persist separate facts. A payer's later “No” cannot alter the machine outcome.
Primary INVALID: display the machine's rule failure; do not create an entitlement proof pack or enter UE-5 (VALID-only).
Replay FAIL: primary may remain VALID, but entitlement stays unverified; show failure and operator action required, with no automatic patch retry.
Missing report/interrupted process: verification incomplete, not a fabricated FAIL or PASS.
No optimistic EARNED flash while replay is pending.

| Human result | Evidence source |
|---|---|
| Frozen base | freeze closure + suite/lockfile checks |
| Regression fixed | patched acceptance GREEN + base regression RED |
| Existing suite | patched baseline GREEN |
| Allowed scope | policy_result OK |
| Dependencies | dependency policy OK |
| Determinism | full N/N |
| Primary outcome | validated UE-2 record |
| Independent replay | trusted UE-4 report, same verdict and current pack bindings |
| EARNED | conjunction above, derived through frozen validation |
| Technical details/download | nine-file proof pack + trusted verifier instructions |

## F5 — Record Payer Response (D9, P1)

Available only on UE-5's verified-VALID evidence path.
Keep **Machine result: TIER 1 EARNED** visible throughout.
Technical evidence and user evidence are separate.

1. “According to the rules you agreed to before work began, has this worker earned the Tier-1 reward?”
Map to `payer_accepts_tier1`; capture `payer_ack_verbatim` and observation timestamp.
On No immediately prompt **Tell us why** and preserve the payer's exact words.
2. “Are you trying to change any Tier-1 rule after seeing the result?”
Map to `posthoc_rule_change_attempts` and one `posthoc_rule_change_details` entry per attempt. A stated wish to change rules is evidence, never permission to edit the frozen contract.
3. “Would you fund another task using this structure?”
Options: **Yes / No / Answer later**.
Yes/No map to frozen `repeat_fund_intent=YES/NO`.
Answer later remains unresolved UI state; it is never mapped to NO and prevents finalize.
The operator may explicitly close unresolved follow-up using frozen `NOT_ASKED`, recording verbatim hesitation and why the experiment ended without a definite answer in provenance. NOT_ASKED must not be presented as a definite refusal or as proof the question was never displayed.
Do not widen the frozen enum.

Use existing `LedgerObservationsV1` fields exactly:
`observation_source`, `observer_identity`, `source_record`,
`source_record_sha256`, `payer_attestation=UNSIGNED_RECORDED`.
Default label: **USER EVIDENCE — OBSERVED / UNSIGNED**.
If a signed statement is recorded: **SIGNED_STATEMENT / RECORDED — NOT MACHINE-VERIFIED**.
Never claim “PAYER-ATTESTED”, verified identity or machine-verified signature.

Observations append immutably; revisions before final remain separate records.
Final ledger is derived from latest valid observation and written once.
No unresolved required response may silently become a default.
Finalization records the experiment; it cannot turn payer rejection into acceptance or invalidate earned Tier 1.

## Phase and independent facts (D7)

Phase is a navigation projection, not a replacement for evidence.

| Primary phase | Basis |
|---|---|
| DRAFT | inputs incomplete, preparation absent/invalid or preparation failure |
| READY TO FREEZE | successful current preparation report + reviewed input snapshot; operational state, not frozen contract |
| FROZEN | complete validated freeze generation |
| SUBMITTED | immutable worker.patch present for this run |
| VERIFYING | orchestrator currently running primary verification or replay |
| AWAITING PAYER | verified VALID + matching independent replay PASS; UE-5 eligible |
| FINALIZED | valid final-ledger.json exists |

Keep independent badges in every later phase:
TASK = FROZEN / NOT FROZEN;
TIER 1 primary result = VALID / INVALID / PENDING;
REPLAY = PASS / FAIL / PENDING;
PAYER RESPONSE = RECORDED / NOT RECORDED.
“Primary VALID” must never visually imply verified EARNED while replay is pending/failed.
Terminal INVALID and replay failures are result/error panels on the submitted workflow; do not invent an AWAITING PAYER path that UE-5 rejects.
FINALIZED retains all historical badges; no preceding fact disappears.

PERSISTENT FACTS = validated artifacts/reports on disk.
TRANSIENT UI STATE = orchestrator process state (preparing, publishing, verifying, replaying).
On reload, validate disk facts. On service restart, do not infer a running process from missing output; show interrupted/incomplete and operator action required.
File presence alone is insufficient for verified claims.
Typical finalized successful page: FINALIZED / FROZEN RULES ✓ / TIER-1 OUTCOME EARNED / INDEPENDENT PROOF ✓ / PAYER RESPONSE RECORDED.
Only render this combination when all supporting facts actually exist.

## Local Orchestrator integration

Chosen: local Node service wrapping existing frozen modules; one facilitated experiment, loopback-only, no hosting, accounts or auth.
Preparation calls `runPreflight`; explicit assent calls `freezeExperiment`.
Run/proof/replay/ledger call existing modules/executables; no copied policy, verifier or entitlement engine.
The portable verifier remains independent; do not replace it with the runner.
Operational preparation/submission state is not a new protocol object.
Given identical inputs, authoritative outputs must match CLI bytes. Real timestamps remain explicit inputs; never mutate frozen artifacts to normalize them.
All preparation and test scratch writes use OS temp; keep operational sidecars/reports outside exact freeze/proof generations.
Browser controls are participation aids, not authentication.
Display the operating mode and declared-identity limitation before freeze and on response recording.

## Implementation acceptance contract

D4–D9 are mandatory, not optional copy improvements.
Before implementation PASS, provide evidence for:
- Prepare publishes no freeze pack; only explicit reviewed agreement freezes; edits invalidate readiness; recheck failure/mismatch cannot silently freeze different reviewed terms.
- Missing payer/assigned worker blocks freeze; SINGLE_CLAIMANT is visible.
- UE-2 VALID + replay pending/FAIL/stale/mismatched/untrusted evidence never renders EARNED, including intermediate render frames.
- Bound matching VALID/PASS produces EARNED; payer rejection preserves it and records verbatim rejection.
- Phase changes retain badges; restart never invents running processes or completed verification.
- Tier-2 zero shows unused; nonzero declared-only view exposes no review/settlement control.
- Declared identities and OBSERVED / UNSIGNED never become authenticated/signed claims.
- Submission cannot be replaced; INVALID has no UI retry; failed verification cannot bypass UE-5 eligibility.
- Answer later prevents finalize; NOT_ASKED requires explicit operator closure/provenance; enums unchanged.
- Frozen module bytes/trust anchors unchanged; artifact outputs remain compatible; repository hygiene passes.

Gate summary:
INFORMATION ARCHITECTURE = PASS
CORE PRODUCT LANGUAGE = PASS
F1–F5 SCOPE = PASS
LOCAL ORCHESTRATOR DIRECTION = PASS
D4–D9 INTERACTION SPEC = CLOSED IN THIS DOCUMENT
PRODUCT-UX-R0 = PASS / FROZEN (specification)
FRONTEND-R1 IMPLEMENTATION = GO (implementation evidence still required)
REAL USER EVIDENCE / PMF = NOT ESTABLISHED BY THIS DOCUMENT
