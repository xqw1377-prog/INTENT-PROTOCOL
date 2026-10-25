# Encode Club Solana Hackathon 2026

Online, with the Solana Foundation. Window: 2026-10-12 through 2026-11-08, 23:59 UTC-12. Mid-point checkpoint: 2026-11-01. This repository is the submission. The demo runs on devnet.

## Problem, solution, Solana

People who pay for work and people who do the work still end up arguing about what “done” meant, because that rule was never frozen before the work started. Intent freezes the done-criteria, escrows the reward, and lets a Solana program decide whether the submission earned the escrow. The new devnet program stores the criteria hash and the verification result, holds the SOL, and pays the deliverer once.

## What to run

```bash
cd hackathon-demo
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. Install Phantom or Solflare, switch that wallet to Devnet, and use Airdrop or [faucet.solana.com](https://faucet.solana.com). The sample criteria ask for the sum of 17 and 25. Submit `42`. Then choose Verify and settle. The page links each transaction on Solana Explorer (devnet).

A wrong submission does not move the SOL. The creator can cancel before verification and take the escrow back. Settling twice is rejected by the program.

The loopback experiment UI is a separate, older tool. It binds `127.0.0.1` and does not send these devnet transactions:

```bash
node --experimental-transform-types apps/experiment-ui/server/index.ts --exp-dir <experiment-dir> --port 4319
```

There is no `experiments/001/` directory. That path is reserved for a real external maintainer, repository, and bug. None are in this repo.

## Programs

| Program | Id | Role |
|---|---|---|
| Hackathon escrow, new | [`7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F`](https://explorer.solana.com/address/7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F?cluster=devnet) | Open intents. SOL escrow, criteria hash, program-checked delivery, one settlement. Id is pinned. The devnet account did not exist on 2026-10-25. |
| TESTNET-R1, immutable, not modified | [`ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F`](https://explorer.solana.com/address/ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F?cluster=devnet) | One frozen receipt from September 2026. Upgrade authority is null. |

September proof that one reward settled once, re-read from `https://api.devnet.solana.com` on 2026-10-25:

- Success, error null, claimant test balance 0 → 10 inside the transaction: [`3enZzg…FEZ`](https://explorer.solana.com/tx/3enZzgSBb14E6DS7kRPrTPtTeVZUpdx3HVYFYyGdnRQ4ThCWrQDHPoPJedeXcEa75t79pTz4hkVneqkK15fSrFEZ?cluster=devnet)
- Retry rejected, custom error 108: [`5wkM67…TYGp`](https://explorer.solana.com/tx/5wkM67bRLUPUMSEJcyrB465wFZ1FG3hSdBW29ffb5RKwTtMZBMUsSPSmc82rxB9544gg5f2zK8aLP4w7xZUjTYGp?cluster=devnet)
- Same receipt, different nonce, custom 108: [`59XiQc…HgFx`](https://explorer.solana.com/tx/59XiQc1Qg3AKUo3VkEBuwQUnNiiuwnVfGHqvVGtwEasgMGyiLqeN49LzeouHEfyB8pnCp1ri3u6kPFbGbBxHgFx?cluster=devnet)
- Later replay, custom 108: [`5565rG…58c8j`](https://explorer.solana.com/tx/5565rGLPM9cZVELUJr7T9mT68fLJwyLmKRCmbYAZ4dvaYBMth1Mik3NyRf2Cbz1mCgAM64TDhNSLwFEP59y58c8j?cluster=devnet)

The new program’s source is `packages/hackathon-escrow/program`. The browser codec is `packages/hackathon-escrow/src/index.ts`. Both use the same account offsets and the same SHA-256 preimage: `criteria_hash || submission_hash || 0x01`.

## Devnet deploy status

Checked 2026-10-25 against `https://api.devnet.solana.com`:

- `7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F` — account missing
- `ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F` — executable, program data `AnUxUnVP495vEXzGSwiGpqQAuc1jjyrGARbqxhE1xzzF`, upgrade-authority option byte is 0 (immutable), last deployed slot 505727122

The new `.so` was built with Solana CLI 4.3.2 / `cargo-build-sbf` 4.4 / platform-tools v1.57. Loaded on `solana-test-validator` at the pinned id, one local run did all of the following: create the sample intent (0.05 SOL), reject submission `41` with custom error 207, settle submission `42`, reject a second settle with custom error 208, and return escrow lamports on cancel. The script is `hackathon-demo/scripts/local-roundtrip.ts`. It is not part of CI.

The deployer pubkey is `4ZJVcnWWJmAdmqz8Trt334HKbx3geXTf5FMBaX2yjpUT`. Its balance was 0. `requestAirdrop` returned 429 (“airdrop limit today or the faucet has run dry”). Neither keypair is in this repository. `packages/hackathon-escrow/program/target/` is gitignored, so the `.so` is not in git either.

Remaining step, on the machine that holds `~/.config/solana/hackathon-escrow.json` (program id) and `~/.config/solana/hackathon-deployer.json` (payer):

1. Send at least 2 devnet SOL to `4ZJVcnWWJmAdmqz8Trt334HKbx3geXTf5FMBaX2yjpUT`. Fund a browser wallet at [faucet.solana.com](https://faucet.solana.com), then transfer. Do not commit either keypair.
2. Rebuild the gitignored binary if needed. The 1.18 platform-tools cargo cannot parse this lockfile; use CLI 4.x:

```bash
cargo-build-sbf --manifest-path packages/hackathon-escrow/program/Cargo.toml
solana program deploy packages/hackathon-escrow/program/target/deploy/hackathon_escrow.so \
  --url https://api.devnet.solana.com \
  --program-id ~/.config/solana/hackathon-escrow.json \
  --keypair ~/.config/solana/hackathon-deployer.json
solana program show 7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F \
  --url https://api.devnet.solana.com \
  -k ~/.config/solana/hackathon-deployer.json
```

3. The program show output has to say the account is executable. Then `cd hackathon-demo && npm run dev` is the end-to-end flow.
4. Only after that flow works, the deployer may hand upgrade authority to the existing founder pubkey `q9jYp8Jg2uNLrfxRhXs7VR275VYvGPbvYruvSoHpf6B`:

```bash
solana program set-upgrade-authority 7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F \
  --new-upgrade-authority q9jYp8Jg2uNLrfxRhXs7VR275VYvGPbvYruvSoHpf6B \
  --url https://api.devnet.solana.com \
  --keypair ~/.config/solana/hackathon-deployer.json
```

Do not run that against `ASvnm4pi…`. If the two keypairs above are gone, generate a new program-id keypair, replace `declare_id!` and `PROGRAM_ID` together, rebuild, and deploy with a funded key. The demo reads `PROGRAM_ID` from the codec.

## Offline checks

```bash
cp -a packages/gp5-proof-pack/pack /tmp/intent-gp5-pack
cd /tmp/intent-gp5-pack && node verify.mjs

cd -
cp -a packages/solana-devnet-adapter/t5-proof-pack /tmp/intent-t5-pack
cd /tmp/intent-t5-pack && node verify.mjs
```

Expect `710/710 checks passed` and `54/54 checks passed`. Node.js 22 or newer. No API key.

## Deploy the website

This checkout does not include a Vercel token. On a machine where `npx vercel login` has already succeeded:

```bash
npx vercel --prod
```

Run that at the repository root. Do not set a Root Directory override and do not add environment variables. The output directory is `hackathon-demo/dist`.

## Track

Enter **Best Consumer App on Solana**. Do not enter Best Use of x402 on Solana for this checkpoint. The reasoning is in [docs/ENCODE-SUBMISSION.md](docs/ENCODE-SUBMISSION.md).

## What is not claimed

No customers, no partners, no mainnet funds, no protocol token. The September asset is a test mint, not Circle USDC. The new demo escrows devnet SOL. Real payer, real task, and real external worker in the experiment ledger remain 0.
