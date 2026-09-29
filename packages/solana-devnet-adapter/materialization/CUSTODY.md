# TESTNET-R1 Key Custody (T3 materialization)

## Governance wording (T3-R1, exact)

```
DEVNET MATERIALIZATION WRITES = YES  (create mint, create 2 ATAs, mint supply, revoke authority)
PROGRAM DEPLOYMENT            = NO
SETTLEMENT TX                 = NO
RELEASE TX                    = NO
```

These materialization transactions do not cross the T2 boundary (no program
deployment, no payment/release), but this phase is NEVER described as
"zero chain action".

## Where the secrets live

All TESTNET-R1 secret key material is stored OUTSIDE this repository, on the
operator machine (xinquanwang), with `0600` permissions:

```
~/intent-testnet-r1-keys/
  program.json     → TESTNET_R1_PROGRAM_ID (ASvnm4pi…)  [pinned BEFORE deployment by design]
  deployer.json    → Deployer   (q9jYp8Jg…)
  operator.json    → Operator   (673H3SuS…)
  treasury.json    → Treasury   (8QW7mvyn…)
  claimant.json    → Claimant wallet (6ce8Q7hx…)
  mint.json        → USDC-test mint  (CGLUuUda…)
```

**Secrets are NEVER committed.** The repository carries only the public
keys and hashes (`src/frozen.ts` PINNED + `materialization/appendix-a.json`).
A machine test scans the package tree to keep it that way.

## Role authority (T0 §7)

- **Deployer** — devnet program deployment ONLY (a T2-authorized bootstrap
  action); cannot authorize settlements.
- **Operator** — may request settlements ALREADY authorized by GP4
  semantics; cannot alter claimant / amount / receipt / asset.
- **Treasury** — original mint authority (authority REVOKED at T3-R1:
  `mint_authority = null`, supply hard-capped at 100); current test-USDC
  holder and source; **NO LONGER mint authority**.

## Funding provenance

- devnet SOL: 5 SOL to Treasury via faucet.solana.com (human claim).
- USDC-test: mint created by Treasury; supply exactly 100 USDC-test, then
  the **MintTokens authority was REVOKED** (T3-R1) — `mint_authority = null`
  on chain, so the total-supply hard cap of 100 now holds structurally.
  All real creation/revoke transaction signatures are recorded and
  re-verified by `scripts/t3-materialize.mjs --verify`.

## Loss policy

These are TEST-ONLY identities on devnet holding zero real value. Loss of
the keypair files invalidates the corresponding pinned slot and requires a
fresh T3 materialization under a new Commander order; nothing else is at
risk. Back them up (encrypted) if reproducibility of this exact
materialization matters.
