# [DRAFT] P0-S0 independent conformance harness (Builder B)

## What this is

An independent black-box conformance harness for the Intent Protocol schema
layer and canonical hash rules, per the P0-S0 mandate. It does **not** modify
any protocol implementation file and does **not** reuse Builder A code as
verification logic: the reference canonicalizer/hasher/Merkle in
`src/reference/` are written from the written protocol rules (ADR-005, arch
doc §6.1) and import only `node:crypto`.

**No schema freeze is declared. Freeze authority belongs to the Commander.**

## Verdict against the pinned SUT snapshot

**140 PASS / 5 FAIL / 32 UNKNOWN — gate NOT_READY.**

- Report (machine-readable, schema-validated): `report/conformance-report.json`
- Report (summary): `report/conformance-report.md`
- Every PASS binds test evidence; every FAIL embeds its failure message and a
  reproduce command; every UNKNOWN carries a rationale and never auto-promotes.

### FAIL findings (all reproducible)

1. **C-01-07** — Spec rule 4 says `-0` is rejected; the canonicalizer accepts it and maps it to `0` → 0/−0 hash ambiguity.
2. **C-05-05** — NFC+NFD keys of one object canonicalize to duplicate-key JSON (`{"é":1,"é":2}`): ambiguous canonical text, breaks round-trip.
3. **C-10-03** — `threshold: 2^53` passes the schema (`z.number().int()`) but cannot be canonicalized (safe-integer rule) → schema-valid objects that can never be sealed.
4. **C-13-05** — Timestamp regex accepts impossible calendars (`2026-13-45T99:99:99.999Z`) despite the RFC 3339 claim.
5. **C-13-07b** — U64-as-string regex is unbounded: `2^64` passes the schema, `u64be()` throws at hash time.

### The 32 UNKNOWNs (never auto-PASS)

Two classes, each with rationale in `unknowns.json`:
- **blocked** — enforcing components were not delivered in the S0 snapshot:
  state machines (`@intent/intent-core` absent; bundle lifecycle collapsed to
  OPEN/SEALED vs 7 documented states), Milestone/Plan/Run/Grant/Edge/Dispute
  objects, cross-object referential integrity, policy objects.
- **gap_documented** — behavior demonstrated and recorded where the written
  protocol is silent or the guard lives in an undelivered layer: dangling
  decision/settlement refs, SEALED bundle with lying merkle_root, duplicate
  criterion_id, non-canonical decimals (`-0`, `1.10`), `total_amount` vs
  outputs sum, lookalike SubjectRef ids after the mid-verification charset
  widening, etc.

### Open attack surfaces

14 entries in `attack-surfaces.json`, each grounded in check evidence —
highlights: NFC key-collision ambiguity (AS-01), schema/canonicalizer
split-brain on numeric bounds (AS-03), free-floating cross-object references
vs the §15.1 north-star chain (AS-08), SEALED ≠ correct merkle_root (AS-09),
delivered scope drifting under live edits (AS-12).

## Process note: SUT drift incident

Builder A edited `packages/protocol-schema/src` twice while verification was
running (broken `events.js` export fixed; six object kinds removed; artifact
`content_hash` → `payload_hash`; SubjectRef charset widened). The harness
therefore attacks a **frozen snapshot** (`sut-snapshot/` + `capture.json` with
digests and git head); the report pins exactly those bytes. Re-verification
against a newer SUT: `npm run capture:sut && npm run conformance`.

## Reviewer guide

- Independence check: `src/reference/**` imports nothing from the SUT; `src/sut.ts` is the only SUT import point.
- Reproduce everything: `cd packages/conformance-harness && npm run conformance && python3 scripts/validate-report.py`.
- Per-check reproduce commands are embedded in `report/conformance-report.json`.
- Report self-schema: `schema/conformance-report.schema.json`.

## Not in scope / not claimed

- No modification to Builder A's files (their working tree was snapshotted, never edited).
- No claim that the schema is frozen or freeze-ready; gate status is `NOT_READY`.
- PKG-ENTRY (importing the built package entry) is UNKNOWN: not meaningful to evaluate against a snapshot while the live tree churns.
