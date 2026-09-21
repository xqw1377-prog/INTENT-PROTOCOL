# GP1 Formal Black-Box Replay Report (Builder D)

- Generated: 2026-09-21T07:24:34.287Z
- Formal target: `fc87aa9e09f9ecf72b4bf8e005c3c865a6450999` (pinned via git object database, mode=git-sha)
- Harness head: `bae407fa58ff984197c120731fb3ba297f0d3b22`
- Checks: **11 PASS / 0 FAIL / 0 UNKNOWN** (11)
- Machine gate: **READY** — NONE — machine READY is never an automatic GP1 PASS; the final signature belongs to the Commander.

## Coverage

- 384 seeded oracle vectors replayed field-for-field through the thin black-box adapter
- 13 legal edges reachable; 70 illegal pairs exhaustively rejected; 4-state prerequisite probes on all 5 future-authority edges
- idempotency/conflict; ClaimRecord immutability; crash-at-every-prefix reload against the real durable journal (isolated temp dir)
- scope audit (diff + files + exports) clean; wall-clock independence; no-payment side effects (RELEASED writes ONLY journal.jsonl)

## Checks

| id | status | title |
|---|---|---|
| F0.1 | PASS | [F0.1] the frozen SUT snapshot is pinned to the Commander-published formal target |
| F1.1 | PASS | [F1.1] every seeded trace decision sequence reproduces through the adapter, field-for-field |
| F2.1 | PASS | [F2.1] all 13 legal edges positively reachable through the adapter |
| F2.2 | PASS | [F2.2] exhaustive 70 illegal pairs rejected (branch-sibling sources reached via direct-jump walk) |
| F2.3 | PASS | [F2.3] prerequisite 4-state probes on every future-authority edge: missing / wrong-kind / invalid-shape REJECT, correct ACCEPT |
| F3.1 | PASS | [F3.1] same command_id+payload: identical decision, single journal event; different payload: conflicting-command, no event |
| F3.2 | PASS | [F3.2] ClaimRecord: required at CLAIMED, shape-invalid never appends, immutable after append |
| F4.1 | PASS | [F4.1] journal-file crash at every prefix converges; retry after crash-after-commit is a no-op duplicate-free reload |
| F5.1 | PASS | [F5.1] scope audit: target diff touches no frozen surface, adds no GP2+ artifact, exports stay clean |
| F5.2 | PASS | [F5.2] wall-clock independence: SUT sources contain no wall-clock access |
| F5.3 | PASS | [F5.3] no-payment side effects: no network/escrow/payment surface; a full run to RELEASED writes ONLY the journal file |
