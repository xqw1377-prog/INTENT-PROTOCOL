# GP1 Independent Verifier (Builder D)

Status: **GP1 VERIFIER ORACLE READY / AWAITING COMMANDER TARGET**

Branch `zcode/gp1-independent-replay`, base `main@ac4d1d4e98cb101dd3d4a2548b8c37c095ffd04b`.
Order: Issue #12. Derived ONLY from `docs/GOLDEN-PATH-V1.md` @ a1d9749, `docs/GATES.md`
GP bullets, and the frozen G1 SubjectRef grammar. **No `packages/gp-runtime/**` import
exists anywhere in this package** (machine-asserted by [GP1-D2]); no Builder C
implementation has been inspected. The black-box adapter is written ONLY after the
Commander publishes `GP1 Formal target = <40-char SHA>`.

## What is frozen here

### A. Model oracle (`src/model.ts`)

Four contract state graphs with authority guards and per-edge citations:

| Machine | States | Terminal | Legal edges |
|---|---|---|---|
| Bounty | CREATED→FUNDED→CLAIMED→EXECUTING→SUBMITTED→VERIFIED→SETTLED (7) | SETTLED | 6 |
| Execution | CREATED→RUNNING→SUBMITTED→CLOSED (4) | CLOSED | 3 |
| Verification | PENDING→ACCEPTED \| REJECTED (3) | ACCEPTED, REJECTED | 2 |
| Settlement | LOCKED→ELIGIBLE→RELEASED (3) | RELEASED | 2 |

Counts (asserted in [GP1-A1]): **4 machines / 17 states / 13 legal edges /
70 illegal ordered pairs / 5 terminal negatives**.

Authority guards (contract-cited):
- `FUNDED→CLAIMED` requires the immutable ClaimRecord append (GP-V1 §3 Claim binding);
- `SUBMITTED→VERIFIED` and `PENDING→ACCEPTED` require a SEALED EvidenceBundle —
  **impossible inside GP1 scope** ⇒ negative-only at GP1 (GATES GP1 invariant);
- `VERIFIED→SETTLED`, `LOCKED→ELIGIBLE`, `ELIGIBLE→RELEASED` require an accepted
  OutcomeReceipt — **impossible inside GP1 scope** ⇒ negative-only at GP1.

Consequence the adapter will enforce: a GP1 runtime that ever accepts
VERIFIED / ACCEPTED / ELIGIBLE / SETTLED / RELEASED **without the (unbuildable)
authority** violates the frozen GATES GP1 invariants.

### B. Reference runtime + invariant oracle (`src/reference.ts`)

Builder D's contract-correct ledger semantics: append-only journal, deterministic
fold, and the Issue #12 §B invariant set, each machine-asserted:

| # | Invariant | Check |
|---|---|---|
| B1 | idempotent same-command replay → same decision, no duplicate event | [GP1-B1] |
| B2 | same command_id + different payload → `conflicting-command`, no event | [GP1-B2] |
| B3 | append-only ordering (monotone seq, prior entries immutable) | [GP1-B3] |
| B4 | deterministic replay/reload reproduces states + claims + journal | [GP1-B4] |
| B5 | crash at EVERY journal prefix converges to the uninterrupted run | [GP1-B5] |
| B6 | ClaimRecord immutability (replacement/mutation rejected; shape-invalid never appends) | [GP1-B6] |
| B7 | frozen SubjectRef accept/reject set (no '@') | [GP1-B7] |
| B8 | task_freeze_hash shape `sha256:<64 hex>` | [GP1-B8] |
| B9 | caller-supplied logical time only (identical clock ⇒ identical outcomes) | [GP1-B9] |
| B10 | crash-before-commit ⇒ no transition; crash-after-commit ⇒ retry same result, no duplicate | [GP1-B10] |

### C. Seeded trace vectors (`src/traces.ts` + `vectors/gp1-traces.json`)

8 fixed seeds × 48 ops = **384 commands** mixing legal/illegal/terminal/idempotent/
conflict/authority-gated attempts; expected decisions computed by the reference
runtime. Committed vectors must regenerate byte-identically ([GP1-C1]) and every
expected sequence reproduces from a fresh runtime ([GP1-C2]). At replay time the
same commands are driven through the adapter against Builder C's runtime.

### D. Scope sentinel (`src/scope.ts`)

Structural pre-check of the candidate diff: frozen surfaces (`packages/protocol-schema/**`,
`packages/gp-audit/**`, this package, GP0 docs) untouchable; GP2+ implementation
artifacts (agent runner / evidence-bundle building / verifier+decision /
outcome-receipt formation / escrow release+payment / devnet) flagged by BOTH file
paths and export names — with a no-false-positive proof that pure state-machine
files (e.g. `settlement-machine.ts`, the state name RELEASED) stay clean. Not
string-scan-only: export inspection + the behavioral halves live in B5/B10/A5.

## Adapter contract (to be implemented ONLY after the target SHA is published)

The adapter is a thin layer in THIS package mapping the frozen `Command`
vocabulary onto Builder C's public runtime surface:

```ts
interface GPRuntimePort {
  submit(c: Command): Decision;        // decision must equal the reference model's
  stateOf(m: MachineName, entity: string): string;
  claimOf(bountyId: string): ClaimRecord | undefined;
  journal(): JournalEntry[];           // append-only evidence for B1–B5, B10
  reloadFromIsolatedDir(): GPRuntimePort; // crash/reload from a temp dir (Issue #12 §D)
}
```

The oracle (model/reference/vectors) remains unchanged after publication; only
the adapter is added.

## Reproduction

```bash
npx vitest run packages/gp1-verifier   # 19/19 PASS
GEN_VECTORS=1 npx vitest run packages/gp1-verifier   # regenerate committed vectors (deterministic)
```

## Independence proofs

- No `from "...gp-runtime..."` import in any source/test file — machine-asserted [GP1-D2].
- This branch (vs base) touches ONLY `packages/gp1-verifier/**` — no G1, no gp-audit, no docs.
