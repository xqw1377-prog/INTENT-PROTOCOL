# PRODUCT-UX-R2 — VALUE-FIRST REDESIGN (spec)

Status: **CUT-1 IMPLEMENTED 2026-10-22, codifying the Commander's
directive of the same day.** Nature: EXPRESSION LAYER ONLY. Hard
boundaries: UE-0..UE-5 frozen bytes untouched; server routes/state model
unchanged (same /api/state and action endpoints); no new protocol or
product features; the DIRECTION-R1 STOP list otherwise remains in force
— this redesign is its one authorized exception ("唯一值得做的开发").

## Product truth the UI must express (DIRECTION-R1 / OVERVIEW R3)

```text
Freeze the rules before work. Prove the outcome after work.
No moving the goalposts.
```

The user must feel the contract arc, not an experiment runner:

```text
BEFORE WORK — What counts as done?
→ FROZEN CONTRACT — The goalposts can no longer move.
→ WORK HAPPENS
→ PROOF — Did the outcome satisfy the frozen contract?
→ EARNED — This part is no longer anyone's opinion.
```

## Information architecture

- User-side nav: **CONTRACT · WORK · PROOF · OUTCOME** (+ HOME entry).
  Internal F1–F5 names remain in code/comments only.
- HOME: the 10-second value screen (three-line promise, the contract
  arc, two-sided tension, CTA **"Define an outcome"**).
- CONTRACT: draft conditions (UNFROZEN — still discussable) → the
  pre-commit review → **the FROZEN OUTCOME CONTRACT card** (task,
  reward, worker, frozen-at, WHAT COUNTS AS DONE in human language);
  technical terms collapse to a second layer.
- WORK: the frozen deal from the worker side + one-patch submission
  (write-once, immutable).
- PROOF: **"Prove the outcome"** — Stage A primary verification, Stage B
  independent replay, then the EARNED moment with the triad:
  PROTOCOL FACT (earned) / PAYMENT (not part of this experiment) /
  OPINION (asked separately, recorded separately).
- OUTCOME: the payer/acceptor response (sponsored framing per
  AMENDMENT-1), evidence classes always separate, the one final ledger.

## Visual language — QUIET CONTRACT

Three states, one light:
```text
UNFROZEN  open, discussable (warm-neutral)
FROZEN    sealed, calm, contractual (cool)
EARNED    the single moment the product lights up (reserved green)
```
PAID / SETTLED never appear as states (EARNED ≠ paid is expressed as a
boundary line, not a state).

## Wording rules

- "Define an outcome" (never bounty-creation wording).
- "Prove the outcome" (never bounty-verification wording).
- First layer human sentences; repo/SHA/commands/hashes live in the
  collapsed second layer (nothing verified is hidden — only re-layered).
- Frozen verbatim stays frozen: the server's PRECOMMIT_STATEMENT, the
  F5 questions, and the mandated UI copy lines asserted by the frozen
  test suite ("One experiment is not evidence of product-market fit.",
  "This is a derived protocol result. It is not a maintainer approval.",
  "not used in this experiment", "declared, not authenticated") plus the
  banned-words list — all preserved byte-intact.
- Not an OSS-bounty product: no copy locks the future to GitHub bugs;
  R1 experiments still run GitHub-bug tasks only.

## Machine semantics preserved (test-enforced)

- EARNED renders ONLY from the currently verified chain (D6); AWAITING_PAYER
  lands on the EARNED view; the payer screen is an explicit step (#f5).
- INVALID is terminal (no retry/replace); Answer-later blocks finalize;
  the finalized view consumes only the verified ledger view; integrity
  errors render as errors, never as states.
- No second implementation of backend truth in the web layer (no hash
  computation, no policy parsing, no verdict strings hardcoded).

## Acceptance questions (for Commander review of the live artifact)

1. 10-second test: does a maintainer/worker understand the promise from
   HOME alone?
2. Can a user name the contract's state (UNFROZEN / FROZEN / EARNED) at
   any moment from the header pill?
3. Is the freeze a felt moment (draft → FROZEN OUTCOME CONTRACT semantic
   change)?
4. Does the EARNED screen separate protocol fact / not-paid / opinion
   without developer terms?
5. Is the two-sided tension visible (fake completion ↔ moving goalposts)?
6. Old depth still reachable via "View technical details" (nothing
   verified is hidden)?
