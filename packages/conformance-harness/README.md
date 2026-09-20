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
`report/conformance-report.md` (summary). Current pinned run (**DIAGNOSTIC,
not Formal G1** — remediation-18 self-check of the verifier itself):

- SUT: Builder A pre-candidate `602eac434a836a84d6fc16fc89caccd4fd225706`
  (origin/devin/p0-s0-schema-remediation), captured `mode=git-sha` from the
  git object database (see `sut-snapshot/capture.json`).
- **176 PASS / 0 FAIL / 23 UNKNOWN** across 199 checks (reconciliation-18:
  the two formerly manifest-only UNKNOWN ids C-13-02c / C-13-09b became
  executable PASS checks — they had never been executed before, so the total
  grew by 2 instead of staying 197; no checks were removed)
- Gate status: `READY_WITH_EXCEPTIONS` (0 FAIL + 0 OPEN blockers + UNKNOWN > 0,
  per the frozen machine rule). `freeze_declaration` stays `NONE` — the final
  G1 signature belongs to the Commander, and this run is explicitly NOT the
  formal gate: the formal target must be a Commander-published SHA.
- **20/20 freeze blockers DISPOSITIONED** (all 13 spec-round + all 7
  trust-chain blockers evidence-PASS against this SUT).
- Evidence metadata reconciled to the current SUT facts: stale UNKNOWN
  rationales corrected (PKG-ENTRY-01 / C-08-06 / C-15-06); attack surfaces
  AS-01/02/03/04/05/09/15/16/17 marked REMEDIATED and AS-07/12/13/14
  partially remediated with current evidence.
- Every PASS is bound to a test file + title + duration; every UNKNOWN carries
  a rationale from `unknowns.json` and never auto-promotes to PASS.

The five attack-area findings of the previous pinned run are all remediated in
this SUT and now PASS: C-01-07 (-0 rejected), C-05-05 (non-NFC keys rejected,
no duplicate-key JSON), C-10-03 (unsafe ints rejected at schema parse),
C-13-05 (calendric timestamp validation), C-13-07b (U64 regex upper-bounded).
Attack surfaces AS-01/02/03/04/16/17 are annotated REMEDIATED with this
evidence.

## Verifier remediation-18 (this branch)

The Commander-ordered closeout of 18 stale verifier assertions (PR #5 review
round), all confirmed against SUT 602eac43 and fixed — plus two same-class
residues the diagnostic run exposed (C-11-01 amount/total isolation,
C-14-04 superseded-GAP polarity), fixed under the same classes:

- 3 × settlementKey calls re-parameterized to the FROZEN names
  (`outcome_receipt_hash` / `escrow_ref` / `nonce`): C-02-09, C-11-07, C-12-05.
- 5 × proofBinding calls re-parameterized to the FROZEN R9 six-field
  signature (milestone_id + bundle_id bound): C-12-01/02/03, C-11-03/04
  (C-11-03's values now equal the decision fixture's own fields so the
  parse-time recomputation holds).
- 1 × invalid merkle positive control: C-08-01's EvidenceBundle leg no longer
  declares a fabricated root as a "valid" control (SEALED merkle rule).
- 1 × (plus 2 same-class residues) amount/total isolation: C-08-02 nested
  unknown-field input, C-11-01 amount mutation and lying-digest input are all
  sum-consistent now, so each check fails ONLY on the rule under test.
- 3 × binding-not-recomputed: C-14-02/03/05 recompute proof_binding over the
  mutated fields (decisionWith helper) — the GAPs isolate dangling REFERENCES,
  not binding-rule violations.
- 2 × superseded GAPs: C-09-08 (artifact self content_hash now exists and a
  wrong declared digest is rejected on seal — executable, no longer UNKNOWN)
  and C-10-08 (Milestone IS delivered; only S1 lifecycle machinery remains —
  premise corrected). C-14-04 flipped to assert the frozen rejection of the
  superseded decision-gated wire (same class, found by the diagnostic run).
- 1 × NFC polarity: C-05-05 now asserts IPC-JSON-1 (REJECT the NFC+NFD
  key-collision input) instead of the pre-freeze "preserve both spellings"
  expectation.
- 1 × unsafe-int assumption: C-10-03 now asserts schema-level rejection of
  2^53 with a 2^53-1 safe boundary control (every schema-valid object must be
  sealable).
- 1 × UUID no-op: S-UUID's uppercase probe now carries hex letters — the old
  digit-only probe made `.toUpperCase()` a no-op that tested nothing.

## Trust-chain round (B-TC1..B-TC6, Commander order; docs/TRUST-CHAIN.md @ e28a22e)

The exact wire contracts — exact field names, no aliases — are frozen in
`docs/TRUST-CHAIN.md` at main @ e28a22e. This branch replaces the SUPERSEDED
scaffold (`zcode/g1-trust-chain-conformance` @ ce00035), which guessed field
names by regex slots (`/receipt_id|^id$/`, `intent_hash|intent_commitment`,
`?? ReceiptSchema` fallbacks). Guessing is not verification: every verifier
here asserts the frozen names and fails on anything else.

- **B-TC1 [S-MS-WIRE] / [S-MS-HASH]** `test/17-trust-chain-exact-wire.test.ts`
  — MilestoneV1 exported as `MilestoneSchema`; field set EXACTLY the frozen
  names; literal `milestone.v1`; revision ≥ 1; criterion_ids non-empty/unique;
  allocation scale ≤ decimals. Hash layer: every required field feeds the
  digest; criterion order canonical; domain pinned byte-exactly to
  `intent-protocol/v1/milestone`; round-trip idempotent.
- **B-TC2 [S-RCPT-WIRE] / [S-RCPT-SET] / [S-RCPT-HASH]** — OutcomeReceiptV1 as
  `OutcomeReceiptSchema` (no `ReceiptSchema` fallback); literals
  `outcome-receipt.v1` / `ACCEPTED`; decision_hashes non-empty, unique,
  strictly lexicographically ascending; domain pinned to
  `intent-protocol/v1/outcome-receipt`; digest + round-trip layer separate.
- **B-TC3 [S-GATE-AUTH]** — Settlement exact wire carries `outcome_receipt_hash`;
  `decision_id` / `proof_binding` are FORBIDDEN and unrepresentable; a
  settlement without a receipt is rejected; the superseded decision-gated wire
  must not parse (against the old pre-freeze SUT it did — the historical red
  light; against SUT 602eac43 S-GATE-AUTH-01/02/03 and C-14-04 all PASS).
- **B-TC4 [S-SETTLEMENT-KEY]** `test/18-settlement-key.test.ts` — settlement_key
  frozen byte protocol with mandatory three-way exact agreement:
  - TS oracle `refSettlementKey` (`src/reference/hash.ts`, node:crypto only);
  - Python KAT `scripts/kat-settlement-key.py` (hashlib only), re-derived
    in-suite (`S-SETTLEMENT-KEY-KAT`) and standalone;
  - golden vector `vectors/settlement-key-vector.json` — `expected` computed
    by the **Python** implementation first, then the TS oracle checked against it;
  - SUT leg (`S-SETTLEMENT-KEY-02`): against the old pre-freeze SUT this was
    RED (superseded domain-less proof_binding-keyed preimage); against SUT
    602eac43 the SUT implements the frozen preimage — three-way agreement
    holds (S-SETTLEMENT-KEY-02, C-02-09, C-11-07 all PASS).
- **B-TC5** — the 4 broad scaffold-era blocker ids are split into 7 PRECISE
  blockers — `S-MS-WIRE S-MS-HASH S-RCPT-WIRE S-RCPT-SET S-RCPT-HASH
  S-GATE-AUTH S-SETTLEMENT-KEY` — so a partial SUT shows exactly which layer
  (wire / set rules / hash / authority / key) fails. Registered in
  `unknowns.json` with `freeze_blocking: true`; OPEN/DISPOSITIONED status is
  computed from test evidence by `build-report.mjs`, never hardcoded. 20
  blockers total with the 13 spec-round ids. New attack surfaces AS-16
  (decision-gated settlement on the superseded wire) and AS-17 (superseded
  settlement_key preimage) are grounded in check evidence.
- **B-TC6** — red-light self-test, originally against the OLD pre-freeze SUT
  (every exact-wire check failed for the intended reason); after remediation-18
  the same checks run against SUT 602eac43 and all PASS — the oracle legs
  (TS oracle === Python KAT === golden vector) held throughout, and the SUT
  legs now agree.

Positive settlement fixtures were migrated up-front (not deferred): every
positive settlement check — legacy suites included — uses
`validReceiptSettlement()` on the frozen wire; the old object survives ONLY as
`supersededDecisionGatedSettlement()`, a negative sample asserting the old
authorization wire must be rejected (C-14-04). Defensive detail: test/11's
baseline parses lazily inside each check — a describe-scope parse would abort
collection and silently drop the file from the evidence; `build-report.mjs`
additionally records any failed collection as `SUITE-COLLECT-FAIL`.

Evidence integrity: `run-conformance.mjs` deletes the previous
`vitest-results.json` BEFORE the run and refuses to build a report unless the
run produced a fresh results file (existence + mtime ≥ run start); a dead
vitest process can never dress the previous round's JSON up as new evidence.

Open attack surfaces are catalogued in `attack-surfaces.json` (17 entries,
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

## Freeze blockers (20 normative assertion sets, evidence-driven)

The freeze blocker set is the executable spec assertions in
`test/16-spec-assertions.test.ts` plus the trust-chain exact-wire assertions in
`test/17` / `test/18`; status is computed from evidence (DISPOSITIONED only
when the assertion passes), never hardcoded:

`S-R9 S-RT S-UUID S-ASSET S-SCALE S-BUDGET S-SURR S-KEYNFC S-SUBJ S-UNIQ
S-MERKLE S-DEC S-SUM` (spec round 5 — 13 blockers)

`S-MS-WIRE S-MS-HASH S-RCPT-WIRE S-RCPT-SET S-RCPT-HASH S-GATE-AUTH
S-SETTLEMENT-KEY` (trust-chain round B-TC1..B-TC4, docs/TRUST-CHAIN.md
@ e28a22e — 7 blockers, split per layer so a partial SUT shows exactly which
layer fails: wire / set rules / hash / authority / key)

20 blockers total.

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
build objects on the frozen exact wire @ e28a22e. `validReceiptSettlement` is
the ONLY positive Settlement baseline across the whole harness;
`supersededDecisionGatedSettlement` is a negative-only sample proving the old
authorization wire must be rejected. The settlement-key oracle
(`refSettlementKey`) implements the frozen domain-separated, receipt-keyed
byte protocol; its golden vector was computed by the independent Python KAT
first, and the SUT must reproduce it byte-exactly.

Full remediation flow (Devin fixes → re-capture at the same pushed SHA →
re-run all conformance → Commander reviews diff / golden vectors / independent
report / UNKNOWN disposition → G1 PASS/REJECT): the harness side is exactly
the two commands above.
