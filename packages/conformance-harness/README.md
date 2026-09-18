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
`report/conformance-report.md` (summary). Current pinned run (Builder B
branch `zcode/g1-exact-wire-verifiers`, SUT snapshot unchanged — the OLD
decision-gated SUT, deliberately, see B-TC6 below):

- **141 PASS / 31 FAIL / 25 UNKNOWN** across 197 checks (15 mandated attack
  areas + spec assertions + trust-chain exact-wire verifiers + settlement-key
  three-way + SUT loadability)
- Gate status: `NOT_READY` (17/17 freeze blockers OPEN)
- Every PASS is bound to a test file + title + duration; every FAIL carries the
  raw failure message (the reproduction output); every UNKNOWN carries a
  rationale from `unknowns.json` and never auto-promotes to PASS.

The 5 implementation FAIL findings (attack areas):

| Check | Finding |
|---|---|
| C-01-07 | Spec rule 4 says `-0` is rejected; the canonicalizer accepts it and silently maps it to `0` (0/-0 hash ambiguity). |
| C-05-05 | An object holding both the NFC and NFD spelling of one key canonicalizes to **duplicate-key JSON** — ambiguous canonical text (`{"é":1,"é":2}`). |
| C-10-03 | Schema accepts `threshold: 2^53` (integer, not safe); sealing then throws. Schema-valid objects exist that cannot be hashed. |
| C-13-05 | Timestamp regex accepts calendrically impossible strings (`2026-13-45T99:99:99.999Z`) despite claiming RFC 3339. |
| C-13-07b | U64-as-string regex has no upper bound: `2^64` passes the schema and fails `u64be()` at hashing time. |

The remaining 26 FAILs are the OPEN freeze blockers' normative assertions
(13 pre-existing spec assertions + the B-TC trust-chain red lights below) —
they fail **because the SUT has not delivered the frozen behavior yet**, which
is exactly what a gate must show.

## Trust-chain round (B-TC1..B-TC6, Commander order; docs/TRUST-CHAIN.md @ e28a22e)

The exact wire contracts — exact field names, no aliases — are frozen in
`docs/TRUST-CHAIN.md` at main @ e28a22e. This branch replaces the SUPERSEDED
scaffold (`zcode/g1-trust-chain-conformance` @ ce00035), which guessed field
names by regex slots (`/receipt_id|^id$/`, `intent_hash|intent_commitment`,
`?? ReceiptSchema` fallbacks). Guessing is not verification: every verifier
here asserts the frozen names and fails on anything else.

- **B-TC1 [S-MS]** `test/17-trust-chain-exact-wire.test.ts` — MilestoneV1
  exported as `MilestoneSchema`; field set EXACTLY the frozen names; literal
  `milestone.v1`; revision ≥ 1; criterion_ids non-empty/unique/order-significant;
  allocation scale ≤ decimals; every required field feeds the digest; domain
  pinned byte-exactly to `intent-protocol/v1/milestone`; round-trip idempotent.
- **B-TC2 [S-RCPT]** — OutcomeReceiptV1 as `OutcomeReceiptSchema` (no
  `ReceiptSchema` fallback); literals `outcome-receipt.v1` / `ACCEPTED`;
  `decision_hashes` non-empty, unique, strictly lexicographically ascending;
  domain pinned to `intent-protocol/v1/outcome-receipt`.
- **B-TC3 [S-GATE]** — Settlement exact wire carries `outcome_receipt_hash`;
  `decision_id` / `proof_binding` are FORBIDDEN and unrepresentable; a
  settlement without a receipt is rejected; **the old decision-gated wire must
  no longer parse** (this is the authority-boundary red light: against the old
  SUT it still parses — finding S-GATE-02).
- **B-TC4 [S-SKEY]** `test/18-settlement-key.test.ts` — settlement_key frozen
  byte protocol with mandatory three-way exact agreement:
  - TS oracle `refSettlementKey` (`src/reference/hash.ts`, node:crypto only);
  - Python KAT `scripts/kat-settlement-key.py` (hashlib only), re-derived
    in-suite (`S-SKEY-KAT`) and standalone;
  - golden vector `vectors/settlement-key-vector.json` — `expected` computed
    by the **Python** implementation first, then the TS oracle checked against it;
  - SUT leg (`S-SKEY-02`): RED — the delivered `settlementKey` cannot accept
    the frozen receipt-keyed parameterization and computes the superseded
    domain-less proof_binding-keyed preimage (C-02-09 / C-11-07 flipped red
    for the same reason; legacy tests now bind to the frozen formula).
- **B-TC5** — the new blockers S-MS / S-RCPT / S-GATE / S-SKEY are registered
  in `unknowns.json` with `freeze_blocking: true` and their OPEN/DISPOSITIONED
  status is computed from test evidence by `build-report.mjs`, never hardcoded.
  New attack surfaces AS-16 (decision-gated settlement on the superseded wire)
  and AS-17 (superseded settlement_key preimage) are grounded in check evidence.
- **B-TC6** — red-light self-test against the OLD SUT snapshot (unchanged
  `capture.json`): every exact-wire check fails for the intended reason —
  Milestone/Receipt: "must be exported under its EXACT frozen name";
  Settlement: field set is not the frozen set; old authority wire still parses;
  settlement_key: "does not accept the FROZEN receipt-keyed parameterization".
  The only new green checks are the SUT-independent oracle legs (S-SKEY-01,
  S-SKEY-KAT) — TS oracle === Python KAT === golden vector.

When Builder A lands the 8-object receipt-gated chain, re-capture at the new
pushed SHA (`npm run capture:sut -- --sha <commit>`) and re-run. Note: legacy
settlement fixtures (`validSettlement`) pin the OLD decision-gated wire on
purpose; the legacy S-ASSET/S-SCALE/S-SUM/S-DEC/S-RT settlement checks must be
re-synced to `validReceiptSettlement` as part of that re-verification round —
shape drift is a reportable protocol event, not something the harness silently
absorbs.

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
test/16             executable spec assertions (R9–R14 + OQ dispositions, [S-*] ids)
test/17             trust-chain EXACT-WIRE verifiers (B-TC1..3, [S-MS|S-RCPT|S-GATE-*])
test/18             settlement-key frozen byte protocol (B-TC4, [S-SKEY-*])
vectors/            JSON test vectors (canonical goldens hand-verified;
                    settlement-key golden computed by the independent Python KAT first)
unknowns.json       rationale for every UNKNOWN (gap_documented | blocked) +
                    freeze_blocking registry (status computed from evidence)
attack-surfaces.json open attack surfaces, grounded in check evidence
schema/             JSON Schema for the report itself
scripts/capture-sut.mjs   freeze a new SUT snapshot
scripts/build-report.mjs  vitest JSON -> conformance-report.{json,md}
scripts/validate-report.py dependency-free structural validation of the report
scripts/kat-proof-binding.py   independent Python R9 KAT (third implementation)
scripts/kat-settlement-key.py  independent Python settlement-key KAT (third implementation)
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

## Freeze blockers (17 normative assertion sets, evidence-driven)

The freeze blocker set is the executable spec assertions in
`test/16-spec-assertions.test.ts` plus the trust-chain exact-wire assertions in
`test/17` / `test/18`; status is computed from evidence (DISPOSITIONED only
when the assertion passes), never hardcoded:

`S-R9 S-RT S-UUID S-ASSET S-SCALE S-BUDGET S-SURR S-KEYNFC S-SUBJ S-UNIQ
S-MERKLE S-DEC S-SUM` (spec round 5)

`S-MS S-RCPT S-GATE S-SKEY` (trust-chain round B-TC1..B-TC4,
docs/TRUST-CHAIN.md @ e28a22e)

R9 = proof binding covers milestone_id AND bundle_id; R10 = all five
first-class objects seal/round-trip idempotently and reject wrong declared
hashes; plus canonical UUID text, single-asset settlement, amount scale ≤
asset.decimals, execution_cap ≤ total, lone-surrogate rejection, keys
already NFC (IPC-JSON-1), no '@' in SubjectRef, id uniqueness, SEALED
merkle recomputation, canonical Decimal V1, and exact output-sum equality.
Cross-object referential existence is DEFERRED to S1 (Commander ruling) and
is not a G1 blocker.

Trust-chain blockers: MilestoneV1 and OutcomeReceiptV1 delivered on the EXACT
frozen wire (names, literals, field rules, domain-pinned digests); settlement
structurally receipt-gated (outcome_receipt_hash required; decision_id /
proof_binding forbidden); settlement_key = SHA256("intent-protocol/v1/settlement-key"
|| 0x00 || outcome_receipt_hash[32] || UTF8(escrow_ref) || 0x00 || nonce_u64be[8])
with three-way exact agreement (TS oracle + Python KAT + SUT).

## Machine gate status (frozen rule)

```
FAIL > 0  OR  OPEN blocker > 0   ->  NOT_READY
0 FAIL + 0 OPEN + UNKNOWN > 0    ->  READY_WITH_EXCEPTIONS
0 FAIL + 0 OPEN + 0 UNKNOWN      ->  READY
```

A machine `READY` is NEVER an automatic G1 PASS: `freeze_declaration` stays
`NONE` and the final signature belongs to the Commander.

## Fixture & oracle baseline

All common fixtures (`validIntent/validSettlement/validDecision/validBundle`)
are legal under the FROZEN spec: minimal-form decimals, R9-exact oracle-computed
`proof_binding`, SEALED bundles carrying the correct recomputed `merkle_root`
and `sealed_at`. The independent oracle implements IPC-JSON-1 (keys must
already be NFC; lone surrogates rejected; values NFC-normalized) and the R9
six-field binding. Every must-throw spec assertion uses inputs that are legal
under every OTHER frozen rule and carries a matched control case.

Trust-chain fixtures (`validMilestone/validOutcomeReceipt/validReceiptSettlement`)
build objects on the frozen exact wire @ e28a22e; the legacy `validSettlement`
keeps the OLD decision-gated wire on purpose (legacy suites pin the old SUT;
see the trust-chain round section for the re-sync note). The settlement-key
oracle (`refSettlementKey`) implements the frozen domain-separated, receipt-keyed
byte protocol; its golden vector was computed by the independent Python KAT
first, and the SUT must reproduce it byte-exactly.

Full remediation flow (Devin fixes → re-capture at the same pushed SHA →
re-run all conformance → Commander reviews diff / golden vectors / independent
report / UNKNOWN disposition → G1 PASS/REJECT): the harness side is exactly
the two commands above.
