# EXPERIMENT-001 — Candidate Shortlist & Screening Record

Status: **DRAFT — NOTHING SENT.** Recruitment is IN PROGRESS; no maintainer
has been contacted; no participant is secured; the experiment has not run.
Operator: ZCode. Sending channel: the Commander's own account (first public
contact is a one-shot reputational act — ZCode holds no authenticated
GitHub channel; `gh auth status` verified unauthenticated 2026-10-03).

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

Screening artifacts (in /tmp, disposable): screening red test encodes the
issue's fix option 1 (makeDroppable returns a cleanup fn); the FROZEN
acceptance test will be written WITH the maintainer at PREP and may
instead encode the behavior-level contract (no resurrection after
dispose) — that choice is the maintainer's, at freeze time.

## First-contact draft (remcoder, via #530) — NOTHING SENT

Follows the frozen template (experiment first; no protocol, no
blockchain, no proof architecture, no product pitch; one qualifying
question; refusal = data):

> Hi Remcoder — I'm helping run a small, facilitated experiment about
> pre-agreed standards in open-source work, and gcode-preview looks like
> a great fit.
>
> You have a real, still-open bug: #530 — makeDroppable never removes
> its listeners, so a disposed preview can be resurrected by a drop
> (your own write-up, including the two fix options).
>
> Before anyone touches it, we would freeze — with you — exactly what
> counts as fixed: which new test must go from red to green (written
> together with you, mirroring your existing src/__tests__/dom-utils.ts
> patterns), which files may change, how big the patch may be. An
> external contributor then does the fix. A separate machine re-runs
> everything from the frozen baseline, offline, from your package-lock.
>
> The one thing we're testing: if the pre-agreed conditions are all
> satisfied, will you acknowledge that the fixed reward for that part
> has been earned — rather than redefining the standard afterwards?
>
> Would you be willing to sign off on the rules BEFORE seeing the
> solution?

If the answer is "no": record it as user evidence (payer_accepts = false
path); do NOT shop for a friendlier maintainer in the same round.

## Open items before Freeze (per Commander order)

1. Send the first contact from the Commander's account (or run
   `gh auth login` and authorize this specific target).
2. Pre-designate the external worker (single claimant, unaffiliated with
   the maintainer) BEFORE freeze.
3. PREP with the maintainer: pin base commit, write the frozen
   acceptance test (red), set the symbolic Tier-1 amount, confirm
   identities.
4. Only then F1 (Check eligibility via apps/experiment-ui on the REAL
   repo — the screening above predicts it passes, but the UI preflight
   is the authority, not this document).
