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
GP4-A/GP4-B         = PASS / FROZEN
GP4-C/D/E/F         = BUILT / SIGN-OFF HOLD (D-09 HARDENED, STABILITY PROOF ON FILE)
GP5                  = BUILT / SIGN-OFF HOLD (PACK REGEN DETERMINISTIC)

CURRENT GATE        = MAIN-CLOSURE-R1 (COMMANDER): NO NEW FEATURES, NO TESTNET
NEXT TARGET         = FINAL GATE (FRESH CLONE GREEN + CLEAN), THEN GP4+GP5 SIGN-OFF, THEN TESTNET DISCUSSION (DENIED UNTIL G5)

LOCAL SETTLEMENT    = IMPLEMENTED / NOT SIGNED
PROOF PACK          = packages/gp5-proof-pack (verify: cd pack && node verify.mjs)
TEST SUITE          = HEALTH SUITE MUST BE GREEN (GP2 SEEDED-RED LIVES IN THE ISOLATED GP2 FLOW)
TEST HYGIENE        = ENFORCED (git status before==after; R1)
TESTNET             = DENIED UNTIL G5
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
