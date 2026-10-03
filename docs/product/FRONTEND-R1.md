# PRODUCT-UX-R0 / FRONTEND-R1 — Minimal Experiment Product

Status: **HOLD-6 contract incorporated (docs/product/FRONTEND-R1-SPEC.md
REVISION 2: D4–D9 + P1 rulings + the 10-item implementation acceptance
contract). IMPLEMENTED END-TO-END at apps/experiment-ui — F1 Prepare/
Check/Freeze (snapshot readiness, pre-commit moment), F2 Frozen Task,
F3 Submit (write-once), F4 two-stage verification + EARNED (derived
VALID ∧ fresh-bound replay PASS only) + INVALID terminal, F5 payer
response (verbatim capture, Answer-later blocks finalize, explicit
NOT_ASKED closure, one final ledger). All 10 acceptance gates
machine-tested (test/fr3456.test.ts). Implementation correctness
awaits Commander review.**

Run: `node --experimental-strip-types apps/experiment-ui/server/index.ts
--exp-dir <dir> [--port 4319]` → http://127.0.0.1:4319 (127.0.0.1 only;
the experiment directory is an explicit argument by design).

Objective: make EXPERIMENT-001 usable by a real maintainer and a real
worker — without us hand-running JSON, CLIs, and hash explanations.

```text
BACKEND MACHINE  UE-0..UE-5 = PASS / FROZEN-R0 (code frozen; no changes
                                  without a new cut)
NEXT DEVELOPMENT = FRONTEND-R1 (F1–F5 + Experiment status)
PROTOCOL WORK    = HOLD (no protocol/chain/payments/auto-release/
                         concurrent-claim/Tier-2 work)
EXPERIMENT-001   = WAITING FOR FRONTEND-R1 MINIMUM FLOW
```

## Scope (allowed, and only this)

```text
F1  Task Freeze          — repo owner; the "Freeze & Pre-commit" moment
F2  Frozen Task View     — worker; rules are locked, earn conditions plain
F3  Worker Submission    — submit patch
F4  Verification Result  — TIER-1 OUTCOME as rights, not logs
F5  Payer Acknowledgement— the three questions → UE-5 ledger, verbatim
+   Experiment status    — DRAFT → FROZEN → WORK SUBMITTED → VERIFYING
                           → TIER-1 VALID/INVALID → PAYER RESPONSE
                           RECORDED → FINALIZED
Identities (R1): Maintainer / Worker / Observer — plain role labels,
no accounts, no auth.
```

HOLD (unchanged): public marketplace, task discovery feed, account
systems, wallet connection, payments UI, chat, agent marketplace,
leaderboards, profile/reputation, token, DAO, multi-payer, multi-worker
racing, dispute-arbitration UI.

## Product principle (frozen from the ruling)

The frontend's real job:

```text
complex protocol state  →  human-understandable ENTITLEMENT state
```

Three visual objects, potentially the whole visual language:

```text
FROZEN RULES   ·   EARNED   ·   STILL DISCRETIONARY
```

Not a Web3 bounty dashboard. The page's sentence is: "The rules are
frozen; now tell me what has been EARNED and what is STILL
DISCRETIONARY."

---

# DESIGN INPUT A — page → frozen-artifact data map (field-level)

Every element the UI shows must trace to a real field of a frozen
artifact or a machine report. Nothing invented, nothing re-inflated.

## F1 Task Freeze (payer)

| UI element | Source of truth |
|---|---|
| Repository / Base commit | config `repository_url`, `base_commit_sha` (task.json) |
| Tier-1 / Tier-2 reward | task.json `tier1_reward`, `tier2_reward` |
| "✓ regression currently fails" | freeze-manifest.json `preflight.base_regression = RED` (proven at freeze, in a net-denied sandbox) |
| "✓ existing suite currently passes" | `preflight.baseline_health = GREEN` |
| "✓ no new dependencies" | ruleset `new_dependencies_allowed = false` |
| "✓ only these paths may change" | ruleset `allowed_paths` / `forbidden_paths` |
| "✓ max patch size" | ruleset `max_diff_lines` |
| "✓ runs N times" | ruleset `determinism_runs` |
| "✓ network disabled" | ruleset `network = "disabled"` + `preflight.network_sandbox = DENIED_VERIFIED` |
| "What you still control: Tier-2 review only" | contract-freeze.json `tier2_execution = ABSENT` (R0: declared, not executed) |
| The cardinal sentence + "I agree and freeze" button | `payer_precommit_text` + `payer_precommit_timestamp` → hash-bound into `precommit_binding`; THIS is the pre-commit moment |

**Gap D1 (design must rule): the frozen contract has NO bug-description
field — deliberately (only machine-checkable facts are frozen).** The
human bug description should be an UNFROZEN sidecar: `experiment-notes.json`
{ issue_url, summary, payer_quote } clearly labeled "not part of the
frozen contract". No schema change, no amendment needed.

## F2 Frozen Task View (worker)

| UI element | Source |
|---|---|
| Issue / bug description | sidecar `experiment-notes.json` + issue URL (Gap D1) |
| Earn: Tier 1 X / Tier 2 Y | task.json rewards |
| "You earn Tier 1 when:" checklist | same ruleset facts as F1, worker-facing wording |
| "Maintainer cannot change these rules after you start" | precommit binding semantics (UE0-R1..R3: any term change invalidates the binding) |
| Trust footer | EXPERIMENT-001.md frozen anchor block (MAIN SHA + verifier hashes) |
| Download frozen task | the freeze pack (4 files) |

Hidden by default (per ruling): ruleset hash, contract-freeze hash,
precommit binding, verifier internals. "The rules are locked" is the
sentence; the hashes are one click away under "Technical details".

## F3 Worker Submission

Input: one unified diff (paste or file) → saved as `worker.patch` in
the experiment directory → triggers UE-2 run. The UI never inspects the
patch; the policy wall does.

## F4 Verification Result (the aha page)

| UI element | Source (run-record.json / replay report) |
|---|---|
| Frozen base | `checks.freeze_closure = VERIFIED` + suite/lockfile byte checks |
| Regression fixed | `checks.patched_acceptance = GREEN` (with `base_regression_recheck = RED`) |
| Existing suite | `checks.baseline_health_patched = GREEN` |
| Allowed scope | `policy_result = OK` (path/scope wall) |
| Dependencies | `checks.dependency_policy = OK` |
| Determinism | `checks.determinism = n/n` |
| Independent replay | replay report `same_verdict = true`, `status = PASS` |
| TIER-1 ENTITLEMENT: EARNED | `verdict = VALID` — displayed as a DERIVED conclusion, never a button |
| INVALID case | `invalid_reason` mapped to the same human vocabulary (which rule failed) |
| View/Download proof | the 9-file proof pack; verify.mjs instructions |

## F5 Payer Acknowledgement (the user-evidence page)

Shown AFTER the payer sees F4. Three questions, exact mapping to
`LedgerObservationsV1`:

| Question | Field |
|---|---|
| "According to the rules you agreed to before work began, has this worker earned the Tier-1 reward?" | `payer_accepts_tier1` (+ `payer_ack_verbatim` — the UI captures the payer's own words; buttons alone are thin, prompt for one sentence) |
| "After seeing the result, do you want to add or change any Tier-1 rule?" | `posthoc_rule_change_attempts` (0 / 1+ `posthoc_rule_change_details`) |
| "Would you fund another task using this structure?" | `repeat_fund_intent` |
| (auto) | `observation_source`, `observer_identity`, `source_record`, `source_record_sha256`, `payer_attestation = UNSIGNED_RECORDED` (default) |

**Gap D2 (design must rule): "Not sure" is NOT in the frozen enum**
(`YES | NO | NOT_ASKED`). Options: (a) offer Yes/No only while the
question was actually asked, and "ask later" simply doesn't record yet
(becomes NOT_ASKED only if the experiment ends unasked); or (b) widen
the enum — requires a ratified amendment to frozen UE-5. Recommendation:
(a), no amendment.

Wording red lines (frozen — the UI must NOT re-inflate claims):
`SIGNED` renders "SIGNED_STATEMENT / RECORDED — NOT MACHINE-VERIFIED";
technical vs user evidence stay separate lines; no "PAYER-ATTESTED".

---

# DESIGN INPUT B — experiment state machine (disk-level ground truth)

Each UI state must BE a fact about the experiment directory, not a
database row:

```text
DRAFT                      no freeze pack dir yet (F1 in progress)
FROZEN                     freeze pack exists (4 files, closure verified)
WORK SUBMITTED             worker.patch present in the experiment dir
VERIFYING                  UE-2 run in flight (transient)
TIER-1 VALID / INVALID     run-record.json exists; verdict field decides
PAYER RESPONSE RECORDED    observations/001.json… exist (append-only)
FINALIZED                  final-ledger.json exists (once, forever)
```

**Gap D3 (small): "WORK SUBMITTED" has no artifact today** — the runner
consumes a patch path directly. The orchestrator layer should simply
place `worker.patch` (and nothing else) into the experiment directory as
the submission marker; it is operational metadata, NOT a frozen object,
and the run record hash-binds the patch bytes anyway.

Transitions and actors: DRAFT→FROZEN (payer clicks freeze; operator
supplies repo/config), FROZEN→WORK SUBMITTED (worker submits patch),
→VERIFYING→VALID/INVALID (machine), →PAYER RESPONSE RECORDED (payer
answers; observations append), →FINALIZED (finalize once; revisions of
observations allowed before final, final head never forks — UE5-R-FINALITY).

---

# DESIGN INPUT C — integration architecture (design must choose)

The machine is a file-based pipeline (freeze → run → proof → replay →
ledger), single-experiment, pre-money. Two shapes:

```text
(A) READ-ONLY VIEWER       the operator runs the existing CLIs; the UI
                           reads the experiment directory and renders.
                           Zero new trusted code; slowest demo flow.

(B) LOCAL ORCHESTRATOR     one local Node service (localhost, no
    (recommended for R1)   accounts) that wraps the SAME frozen modules
                           in-process (import, not re-implement), writes
                           the same artifacts, and serves the UI. The
                           maintainer clicks "freeze"/"acknowledge" in a
                           browser during a session. Single operator, no
                           hosting, no auth; the trust anchor stays the
                           frozen machine + trust block.
```

Constraints either way: the orchestrator may only CALL the frozen
modules (schema/freeze/run/proof/replay/ledger); it must not restate
their logic; all artifacts it writes must remain byte-identical to the
CLI outputs; frontend tests obey the repository hygiene gate (writes to
OS temp only); `apps/experiment-ui` fits the existing npm workspace
(`apps/*` is already declared).

Identity: Maintainer / Worker / Observer are role labels bound to the
frozen strings `payer_identity` / `worker_identity` (single claimant);
no accounts, no sessions in R1.


## HOLD-6 review fixes (2026-10-03, implementation revision)

Recorded findings and fixes from the Commander's independent review of
9550d4c: (P0-1/P0-2) state derivation rebuilt as ONE verified evidence
chain — freeze closure re-verified, published terms == reviewed
snapshot, run-record patch binding against the CURRENT worker.patch,
proof-pack binding to the current task/patch/record, replay freshness ∧
source-trust; observations and the final ledger are structurally
verified, never presence-decided. (P0-3) first-answer "Answer later"
closes via a complete closure record without a prior observation.
(P0-4) consent binds review_id + the full reviewed terms; a stale
review is refused (409). (P0-5) the ACTUAL verifier module bytes are
hashed and anchored before execution — what is checked is what runs.
(P0-6) acceptance_suite / acceptance_full_suite are explicit inputs;
command-regex guessing removed. F4 EARNED is the landing view of
AWAITING_PAYER; submitted patch bytes are stored EXACTLY as submitted.
Runnable start: apps/experiment-ui/start.sh (uses
--experimental-transform-types; plain strip-types cannot load the frozen
modules' parameter properties). Disclosure: ledger.ts additive exports
changed frozen-module BYTES — compatibility ruling requested; until
ruled, acceptance item 10 is NOT claimed as "bytes unchanged".
