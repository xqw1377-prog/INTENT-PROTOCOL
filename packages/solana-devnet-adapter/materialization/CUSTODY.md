# TESTNET-R1 Key Custody (T3 materialization)

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
- **Treasury** — test USDC source and mint authority; balance under the
  hard cap; funded with 5 devnet SOL (human-assisted faucet claim on
  2026-09-29 — the web faucet prohibits AI agents, so the Commander claimed
  it; the RPC/CLI faucets were IP rate-limited).

## Funding provenance

- devnet SOL: 5 SOL to Treasury via faucet.solana.com (human claim).
- USDC-test: mint created by Treasury (tx signature + slot recorded in
  appendix-a.json); supply exactly 100 USDC-test, held entirely by the
  Treasury ATA — the escrow cap ceiling, structurally never exceeded.

## Loss policy

These are TEST-ONLY identities on devnet holding zero real value. Loss of
the keypair files invalidates the corresponding pinned slot and requires a
fresh T3 materialization under a new Commander order; nothing else is at
risk. Back them up (encrypted) if reproducibility of this exact
materialization matters.
