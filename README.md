# INTENT PROTOCOL

**Human wants. AI acts. Blockchain settles.**

Intent Protocol is a Verifiable Outcome Protocol: a system for turning a human intent into an executable plan, evidence-backed outcome, verified contribution, and deterministic settlement.

## Project status

```text
COMMAND             = ACTIVE
WHITEPAPER          = V0.1
TECH ARCHITECTURE   = V0.1

G0/G1               = PASS / FROZEN
GP0/GP1/GP2/GP3     = PASS / FROZEN
GP3 REGRESSION HRNS = MODE B (FROZEN-REGRESSION) / GREEN
GP4-A/B             = PASS / FROZEN
GP4-C/D/E/F         = PASS / FROZEN (COMMANDER SIGNED)
GP4                 = PASS / FROZEN
GP5                 = PASS / FROZEN (COMMANDER SIGNED)
MAIN-CLOSURE-R1     = PASS / CLOSED

CURRENT GATE        = EXPERIMENT-001 / REAL USER EVIDENCE (Commander
                     2026-10-03: PRODUCT-THESIS-R0 = PASS / FROZEN;
                     USER-EVIDENCE-R0 MACHINE = PASS / FROZEN-R0)
EXE-R0              = PASS / FROZEN (Commander, 2026-09-29 @ 38ac0fb)
TESTNET-R1 / T0     = PASS / FROZEN (Commander, 2026-09-29, basis
                     8648376 + ebf1ed9, adjudicated @ 75407f3)
TESTNET-R1 / T1     = PASS / FROZEN (Commander, 2026-09-29 @ 640ede3)
TESTNET-R1 / T3     = PASS / FROZEN (Commander, basis c6ea4fa + 7e50a08 + fe65cdf)
TESTNET-R1 / T2     = PASS / FROZEN (Commander, basis 5e4c9f3 + 2cabc63;
                     program deployed @ pinned ASvnm4pi…; exactly-once proven
                     on chain: claimant delta exactly +10 once, 8/8 matrix)
TESTNET-R1 / T4     = PASS / FROZEN (Commander, basis 08e43f7 + af9b215 +
                     99e5a16; UNKNOWN≠retry; NOT_LANDED sole retry authority)
TESTNET-R1 / T5     = PASS / FROZEN (Commander, basis 3b414e0 + b16c3e6 +
                     d3371c5; third-party offline proof pack, two-layer
                     provenance, coordinated-tamper resistant)
TESTNET-R1 / T6     = PASS / FROZEN (Commander, basis 4d6ca9e + 660f8cf;
                     golden run closed the loop; T5 frozen bytes preserved,
                     path-level immutability gate T6-09)
TESTNET-R1          = COMPLETE — frozen OutcomeReceipt → devnet settlement →
                     exactly-once → failure reconciliation → third-party
                     proof pack → golden run form one auditable closed loop.
                     COMPLETE ≠ production authorization.
PRODUCTION-HARDENING-R0 = COMPLETE / CLOSED (Commander; EPOCH B sealed:
                     BASE bcea992 → FINAL_SHA 13bf84b, closure 188950d;
                     PH-01 devnet program IMMUTABLE / PH-02 byte portability /
                     PH-03 independent verifier / PH-04 input-domain closure /
                     PH-05 durable journal w/ coupled ruleset identity)
FRONTEND-R1         = PASS / FROZEN-R0 (Commander @ d09c18a, 2026-10-03;
                     all review rounds closed: verified-chain derivation,
                     nine-file byte-verified packs, trusted verifier
                     execution via re-hashed read-only copy in a separate
                     process, snapshot-bound consent, verified-ledger-view
                     only; browser acceptance passed end-to-end). Frontend
                     expansion STOPPED by ruling. LEDGER ADDITIVE-EXPORT
                     COMPATIBILITY = PASS (maintained).
NEXT                = EXPERIMENT-001 — RECRUITMENT IN PROGRESS (Commander
                     GO 2026-10-03; registration per closing confirmation:
                     IN FIELD means the recruitment-execution phase has
                     started — the experiment has NOT run). Real
                     participants: NOT YET SECURED. Experiment: NOT
                     STARTED. Real user evidence: ZERO. Product thesis:
                     NOT validated. Status ladder: recruit maintainer +
                     pre-designated worker → technical screening passes →
                     Freeze (docs/experiments/EXPERIMENT-001.md; ops kit
                     docs/experiments/EXPERIMENT-001-OPS.md).
NEXT DEVELOPMENT    = (superseded — see NEXT above) minimal experiment product
                     (docs/product/FRONTEND-R1.md + frozen spec
                     docs/product/FRONTEND-R1-SPEC.md incl. HOLD-6
                     REVISION 2). Review round-2 (HOLD-4) blockers
                     closed: complete nine-file byte-verified proof
                     packs only; observations/ledger fail without
                     their binding target and the ledger must agree
                     with the latest VALID observation incl. the
                     derived conclusion; replay executes a re-hashed
                     read-only COPY of the anchored verifier bytes in
                     a separate process (never the boot-time module
                     cache); browser first-Answer-later path
                     complete. Browser acceptance passed end-to-end
                     in real Chrome via real page operations
                     (F1→FINALIZED / THESIS MIXED, all badges
                     retained; walkthrough caught + fixed two real
                     frontend bugs). Review round-3 (finalized-ledger
                     authenticity): FINALIZED requires the currently-
                     valid evidence chain; ledger cross-check covers
                     rule-change attempts; /api/state and F5 expose
                     ONLY the verified ledger view (tampered/stale →
                     ledger-integrity panel, never FINALIZED); all
                     three counterexamples machine-tested. Awaiting
                     re-review. PROTOCOL WORK = HOLD.
LEDGER ADDITIVE-EXPORT COMPATIBILITY = PASS (Commander 2026-10-03:
                     reverting the three disclosed exports restores
                     ledger.ts byte-identical to the fe18be0 baseline;
                     scope = those exports only).
EXPERIMENT-001     = WAITING FOR FRONTEND-R1 MINIMUM FLOW (trust anchor
                     frozen at docs/experiments/EXPERIMENT-001.md:
                     MAIN fe18be0 / audit ca0c646 / release
                     sha256:25286e96… / verifier sha256:292d5804…).
USER-EVIDENCE-R0    = PASS / FROZEN-R0 (Commander @ CUT-2R1 ca0c646,
                     2026-10-03). UE-0 / UE-1 / UE-2 / UE-3 / UE-4 /
                     UE-5 = PASS / FROZEN-R0. Technical readiness for
                     EXPERIMENT-001 = YES. Install authority = canonical
                     npm argv, zero shell (INSTALL-R1..R4);
                     USER-EVIDENCE-R0-AMENDMENT-1 records the CUT-1R2
                     schema tightening (docs/AMENDMENTS.md).
CUT-1R2             = PASS / FROZEN-R0 (Commander audit: no blocker
                     found); LANDED REMOTE; schema surface later
                     tightened by ratified AMENDMENT-1.
EVIDENCE SCENE evidence/3b941db2 = CLOSED WITH PERMANENT LOSS
                     (Commander 2026-10-03; disclosure PASS; incident
                     record docs/incidents/EVIDENCE-SCENE-3b941db2-DELETION.md;
                     V3.12 GREEN ≠ evidence-loss adjudicated; no
                     replacement scene fabricated).
VERIFIER RELEASE    = packages/user-evidence-r0/VERIFIER-RELEASE.json —
                     the package-external trust root for portable
                     proof packs (a pack can never vouch for its own
                     verifier).
REAL PAYER / REAL TASK / REAL EXTERNAL WORKER = 0 / 0 / 0 (targets: 1/1/1
                     via EXPERIMENT-001; requires REAL maintainer + REAL
                     repo + REAL bug; no fictional fixtures).

LOCAL SETTLEMENT    = PROVEN / SIGNED
LOCAL GOLDEN PATH   = PROVEN
PROOF PACK          = PROVEN / REPRODUCIBLE / THIRD-PARTY-VERIFIABLE
                      (packages/gp5-proof-pack/pack: cd pack && node verify.mjs)
OFFICIAL CI         = 6/6 SUCCESS @ main 41c0076 (runs 36363313584 / 36363317605 /
                      36363321434 / 36363427164 / 36363432051 / 36363436750)
TEST SUITE          = HEALTH SUITE GREEN; TEST HYGIENE ENFORCED (R1)
TESTNET             = NOT AUTOMATICALLY AUTHORIZED — GP5 PASS PROVES THE LOCAL
                      GOLDEN PATH + EVIDENCE CHAIN ONLY, NOT DEPLOYMENT
MAINNET             = DENIED
TOKEN               = NOT-IN-SCOPE
10K MERGE           = FORBIDDEN
```

## Frozen principles

1. Outcome First.
2. Proof Before Payment.
3. No Token by Default.
4. Executor MUST NOT verify its own result.
5. Full business/evidence data stays off-chain by default; only necessary commitments and settlement finality go on-chain.
6. P0 is single-chain-agnostic and local-first; no multi-chain expansion.
7. 10K Protocol remains an independent protocol connected only through an adapter.
8. A passing implementation test is not a protocol gate pass.
9. UNKNOWN never auto-promotes to PASS.
10. Mainnet is denied until explicit Commander gate approval.

## Command model

- **Founder:** product and business final authority.
- **Commander:** architecture, task contracts, priorities, evidence review, gates, PASS/REJECT.
- **Builder A / Devin:** implementation owner for assigned modules.
- **Builder B / Zcode:** independent verifier / conformance owner for assigned modules.

Builders may not silently change protocol semantics, gate definitions, or scope. Any ambiguity becomes an OPEN QUESTION for Commander adjudication.

## First engineering objective

Freeze and prove six canonical protocol objects:

- `IntentContractV1`
- `CriterionV1`
- `EvidenceArtifactV1`
- `EvidenceBundleV1`
- `VerificationDecisionV1`
- `SettlementInstructionV1`

The repository is evidence-driven. No stage may claim PASS without reproducible proof accepted by the Commander.
