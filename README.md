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

CURRENT GATE        = NONE OPEN — TESTNET-R1 COMPLETE
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
NEXT TARGET         = AWAITING COMMANDER ORDER. Frozen regardless:
                     MAINNET = DENIED; REAL-VALUE FUNDS = DENIED;
                     TOKEN = NOT-IN-SCOPE; PRODUCTION READINESS = NOT CLAIMED.

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
