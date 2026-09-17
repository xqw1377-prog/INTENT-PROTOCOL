# Intent Protocol — P0-S0 Independent Conformance Harness (Builder B)

Independent black-box verification of the Intent Protocol schema layer and
canonical hash rules. **This harness shares no verification logic with the
implementation**: the reference canonicalizer / hasher / Merkle tree under
`src/reference/` were written from the written protocol rules only (ADR-005,
Technical Architecture §6.1, the SUT's own published rule header) and import
nothing from the SUT. The SUT is loaded exclusively through `src/sut.ts`.

**No freeze is declared here. Freeze authority belongs to the Commander.**

## Verdict (point-in-time)

See `report/conformance-report.json` (machine-readable) and
`report/conformance-report.md` (summary). Current pinned run:

- **140 PASS / 5 FAIL / 32 UNKNOWN** across 15 mandated attack areas + SUT loadability
- Gate status: `NOT_READY`
- Every PASS is bound to a test file + title + duration; every FAIL carries the
  raw failure message (the reproduction output); every UNKNOWN carries a
  rationale from `unknowns.json` and never auto-promotes to PASS.

The 5 FAIL findings:

| Check | Finding |
|---|---|
| C-01-07 | Spec rule 4 says `-0` is rejected; the canonicalizer accepts it and silently maps it to `0` (0/-0 hash ambiguity). |
| C-05-05 | An object holding both the NFC and NFD spelling of one key canonicalizes to **duplicate-key JSON** — ambiguous canonical text (`{"é":1,"é":2}`). |
| C-10-03 | Schema accepts `threshold: 2^53` (integer, not safe); sealing then throws. Schema-valid objects exist that cannot be hashed. |
| C-13-05 | Timestamp regex accepts calendrically impossible strings (`2026-13-45T99:99:99.999Z`) despite claiming RFC 3339. |
| C-13-07b | U64-as-string regex has no upper bound: `2^64` passes the schema and fails `u64be()` at hashing time. |

Open attack surfaces are catalogued in `attack-surfaces.json` (14 entries,
each grounded in check evidence) and reproduced in the report.

## SUT drift incident (why the harness pins a snapshot)

Builder A edited `packages/protocol-schema/src` **live, twice, while this
verification was running**:

1. `index.ts` re-exported a missing `./events.js` (package initially unbuildable) — later fixed.
2. `objects.ts` was rewritten: Milestone / Plan / ExecutionRun / CapabilityGrant / ContributionEdge / DisputeCase objects removed; per-object hash helpers replaced by generic `seal()`/`contentHash()`; artifact `content_hash` renamed `payload_hash`; `states.ts` collapsed the bundle lifecycle from 7 documented states to `OPEN|SEALED`; SubjectRef charset widened to include `@`.

A conformance verdict is only meaningful against a frozen input, so the
harness attacks a **verbatim snapshot** of the SUT:

```
packages/conformance-harness/sut-snapshot/   # frozen copy + capture.json (digests, git head, time)
```

The live tree is never loaded by tests. `capture.json` pins the exact bytes
under test, and the report embeds those digests.

## Layout

```
src/reference/      independent canonicalizer, domain hash, Merkle (no SUT imports)
src/sut.ts          the ONLY module allowed to import the SUT (from the snapshot)
src/lib/fixtures.ts black-box object builders + mutation helpers
test/00..15         one suite per mandated attack area (titles carry [C-xx-nn] check ids)
vectors/            JSON test vectors (canonical goldens are hand-verified)
unknowns.json       rationale for every UNKNOWN (gap_documented | blocked)
attack-surfaces.json open attack surfaces, grounded in check evidence
schema/             JSON Schema for the report itself
scripts/capture-sut.mjs   freeze a new SUT snapshot
scripts/build-report.mjs  vitest JSON -> conformance-report.{json,md}
scripts/validate-report.py dependency-free structural validation of the report
report/             generated artifacts (committed as evidence of the pinned run)
```

## Running / reproduction

```bash
# from repo root — runs the harness only (exit code reflects FAIL findings)
npx vitest run packages/conformance-harness

# full pipeline: freeze SUT snapshot (optional re-capture), run, build report
cd packages/conformance-harness
npm run capture:sut   # only when re-verifying a newer Builder A state
npm run conformance   # runs tests (JSON output) then builds report/
python3 scripts/validate-report.py
```

Reproduce any single finding (exact command is embedded per check in the report):

```bash
npx vitest run packages/conformance-harness/test/05-unicode-normalization.test.ts -t "C-05-05"
```

Deliberate FAIL findings make `npm test` exit non-zero — that is the honest
signal, not a harness defect.

## Independence rules enforced

- No Builder A file is modified (their tree is only read by `capture-sut.mjs`).
- `src/reference/` imports only `node:crypto` — it cannot accidentally reuse SUT logic.
- The SUT is never its own verifier: agreement between SUT and the independent
  reference IS the conformance signal; disagreement is a finding.
- UNKNOWN never becomes PASS: `build-report.mjs` maps `[GAP]`-tagged and
  `todo` checks to UNKNOWN with a mandatory rationale; the report schema
  rejects UNKNOWN entries without rationale and FAIL entries without evidence.

## Re-verifying a newer SUT

**Commander discipline (2026-09-17, post-drift ruling): every independent
verification must bind to a commit SHA that is pushed to the remote. Once
pushed, the SHA itself is immutable — branch refs may move, which is why the
anchor is `pinned_sha` (recorded in `capture.json` together with
`remote_url`), while `remote_refs_containing` is corroboration, not the
anchor. No more "I edit locally while you verify".**

Gate evidence additionally requires the dependency to be pinned with the
source: `--sha` mode reads the zod version from the **same commit's
package-lock.json** (`zod_version_source: "pinned-lockfile"`), never from live
`node_modules`, and check `SUT-LOAD-04` fails the run if the zod actually
loaded at test time differs from the recorded one.

```bash
cd packages/conformance-harness
node scripts/capture-sut.mjs --sha <pushed-commit>   # REQUIRED for gate evidence
npm run conformance
python3 scripts/validate-report.py
```

`--sha` mode resolves the commit, refuses to run if it is not reachable from
any remote ref, extracts `protocol-schema/src` from the git object database
(not the live worktree), and records `pinned_sha` + `remote_refs_containing`
in `capture.json`. Legacy worktree capture is retained for point-in-time
diagnostics only and marks itself as not-gate-evidence.

If object shapes changed again, fixtures may need re-syncing — by design,
shape drift is itself a reportable protocol event, not something the harness
silently absorbs.

## CI machine evidence (GitHub Actions, read-only)

`.github/workflows/conformance-evidence.yml` implements the Commander order on
PR #3: gate runs no longer accept locally self-reported results.

- **Trigger:** manual `workflow_dispatch` with an exact 40-hex `target_sha`
  (Builder A commit, must be pushed to origin). The harness revision (the
  branch/commit the workflow runs on) and the SUT SHA are pinned separately.
- **Pipeline:** capture from the git object database at the target SHA
  (refuses local-only/movable SHAs) → full conformance → report validator →
  Job Summary (target SHA, harness SHA, Node version, target/harness lockfile
  SHA-256, zod recorded vs runtime, report counts, FAIL list) → evidence
  artifact uploaded on PASS and FAIL alike.
- **Honest failure:** `npm run conformance` exits with vitest's code (the old
  `;`-chained script swallowed FAIL exit codes — fixed via
  `scripts/run-conformance.mjs`); the workflow defers the non-zero exit until
  after artifact upload, so evidence exists AND the job fails.
- **Permissions:** `contents: read` only. The workflow writes no source, PRs,
  issues, releases, packages or deployments.

Formal entry point policy (Commander order): this workflow is the gate
Actions entry ONLY once it exists on the DEFAULT branch. Per-branch
dispatching is NOT a substitute and must not be treated as gate evidence.

## Freeze blockers

The Commander has ruled that the following UNKNOWNs are S0 protocol semantics
and must be dispositioned BEFORE G1 Freeze (they cannot be deferred to a later
layer); they are flagged `freeze_blocking: true` in `unknowns.json` and
surfaced as `summary.freeze_blockers` in every report:

- uniqueness of `criterion_id` and `constraint_id` (C-07-01, C-07-02)
- the canonical decimal form (C-11-06)
- whether a SEALED bundle must verify its `merkle_root` at seal time (C-15-04)
- which layer owns `total_amount == sum(outputs.amount)` (C-11-05)
- which layer owns Decision/Settlement cross-object binding (C-14-02/03/04)

Full remediation flow (Devin fixes → re-capture at the same pushed SHA →
re-run all conformance → Commander reviews diff / golden vectors / independent
report / UNKNOWN disposition → G1 PASS/REJECT): the harness side is exactly
the two commands above.
