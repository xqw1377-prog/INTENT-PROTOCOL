# Encode Club Solana Hackathon 2026

Online, with the Solana Foundation. Window: 2026-10-12 through 2026-11-08, 23:59 UTC-12. Mid-submission: 2026-11-02, 19:59 Asia/Shanghai. This repository is the submission. The demo runs on devnet.

Live demo: [https://intent-protocol-wine.vercel.app](https://intent-protocol-wine.vercel.app) (HTTP 200 on 2026-10-25). Paste fields for the mid-submission are in [docs/ENCODE-MID-SUBMISSION.md](docs/ENCODE-MID-SUBMISSION.md). Slides: [hackathon-demo/public/slides.html](hackathon-demo/public/slides.html).

## Problem, solution, Solana

People who pay for work and people who do the work still end up arguing about what “done” meant, because that rule was never frozen before the work started. Intent freezes the done-criteria, escrows the reward, and lets a Solana program decide whether the submission earned the escrow. The new devnet program stores the criteria hash and the verification result, holds the SOL, and pays the deliverer once.

## What to run

Open [https://intent-protocol-wine.vercel.app](https://intent-protocol-wine.vercel.app). Install Phantom or Solflare, switch that wallet to Devnet, and use Airdrop or [faucet.solana.com](https://faucet.solana.com). The sample criteria ask for the sum of 17 and 25. Submit `42`. Then choose Verify and settle. The page links each transaction on Solana Explorer (devnet).

The same page locally:

```bash
cd hackathon-demo
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`.

A wrong submission does not move the SOL. The creator can cancel before verification and take the escrow back. Settling twice is rejected by the program.

The loopback experiment UI is a separate, older tool. It binds `127.0.0.1` and does not send these devnet transactions:

```bash
node --experimental-transform-types apps/experiment-ui/server/index.ts --exp-dir <experiment-dir> --port 4319
```

There is no `experiments/001/` directory. That path is reserved for a real external maintainer, repository, and bug. None are in this repo.

## Programs

| Program | Id | Role |
|---|---|---|
| Hackathon escrow, on devnet | [`7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F`](https://explorer.solana.com/address/7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F?cluster=devnet) | Open intents. SOL escrow, criteria hash, program-checked delivery, one settlement. Executable. |
| TESTNET-R1, immutable, not modified | [`ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F`](https://explorer.solana.com/address/ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F?cluster=devnet) | One frozen receipt from September 2026. Upgrade authority is null. |

September proof that one reward settled once, re-read from `https://api.devnet.solana.com` on 2026-10-25:

- Success, error null, claimant test balance 0 → 10 inside the transaction: [`3enZzg…FEZ`](https://explorer.solana.com/tx/3enZzgSBb14E6DS7kRPrTPtTeVZUpdx3HVYFYyGdnRQ4ThCWrQDHPoPJedeXcEa75t79pTz4hkVneqkK15fSrFEZ?cluster=devnet)
- Retry rejected, custom error 108: [`5wkM67…TYGp`](https://explorer.solana.com/tx/5wkM67bRLUPUMSEJcyrB465wFZ1FG3hSdBW29ffb5RKwTtMZBMUsSPSmc82rxB9544gg5f2zK8aLP4w7xZUjTYGp?cluster=devnet)
- Same receipt, different nonce, custom 108: [`59XiQc…HgFx`](https://explorer.solana.com/tx/59XiQc1Qg3AKUo3VkEBuwQUnNiiuwnVfGHqvVGtwEasgMGyiLqeN49LzeouHEfyB8pnCp1ri3u6kPFbGbBxHgFx?cluster=devnet)
- Later replay, custom 108: [`5565rG…58c8j`](https://explorer.solana.com/tx/5565rGLPM9cZVELUJr7T9mT68fLJwyLmKRCmbYAZ4dvaYBMth1Mik3NyRf2Cbz1mCgAM64TDhNSLwFEP59y58c8j?cluster=devnet)

The new program’s source is `packages/hackathon-escrow/program`. The browser codec is `packages/hackathon-escrow/src/index.ts`. Both use the same account offsets and the same SHA-256 preimage: `criteria_hash || submission_hash || 0x01`.

## Devnet deploy status

Re-read on 2026-10-25 from `https://api.devnet.solana.com` with `solana program show`:

| | Hackathon escrow | TESTNET-R1 |
|---|---|---|
| Program | [`7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F`](https://explorer.solana.com/address/7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F?cluster=devnet) | [`ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F`](https://explorer.solana.com/address/ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F?cluster=devnet) |
| Program data | [`4R5a3NYMFwaP6bK6GTvfcTpNnx3Nvm6tGagy5AyCJxm3`](https://explorer.solana.com/address/4R5a3NYMFwaP6bK6GTvfcTpNnx3Nvm6tGagy5AyCJxm3?cluster=devnet) | [`AnUxUnVP495vEXzGSwiGpqQAuc1jjyrGARbqxhE1xzzF`](https://explorer.solana.com/address/AnUxUnVP495vEXzGSwiGpqQAuc1jjyrGARbqxhE1xzzF?cluster=devnet) |
| Authority | `4ZJVcnWWJmAdmqz8Trt334HKbx3geXTf5FMBaX2yjpUT` | none (immutable) |
| Last deployed slot | 514886402 | 505727122 |
| Data length | 78640 bytes | 100016 bytes |
| Account balance | 0.40037004 SOL | 0.50896012 SOL |

Deploy transaction, finalized: [`3aGkjKFgswMQgZVvn6VoZZM2Reyhs7uDTSENp2eqQaqcZVgUp3Ub5J5bCbWruqkk585KjS5NHrubgVWN1pXqbSjx`](https://explorer.solana.com/tx/3aGkjKFgswMQgZVvn6VoZZM2Reyhs7uDTSENp2eqQaqcZVgUp3Ub5J5bCbWruqkk585KjS5NHrubgVWN1pXqbSjx?cluster=devnet).

Sample settlement on that program, finalized (submit `42`, pay the deliverer once): [`64N3e5KBXaK4Tm5vYmWWvCEWCPSLMwdq1aXSQQeDzzhFTchaaRNTUXh7a5nx4T9YnAcPaFWSkqBo1jXYoDCPw6jT`](https://explorer.solana.com/tx/64N3e5KBXaK4Tm5vYmWWvCEWCPSLMwdq1aXSQQeDzzhFTchaaRNTUXh7a5nx4T9YnAcPaFWSkqBo1jXYoDCPw6jT?cluster=devnet). The same devnet run rejected `41` with custom error 207 and a second settle with custom error 208.

The program-id keypair and the upgrade-authority keypair are not in this repository. `packages/hackathon-escrow/program/target/` is gitignored. Do not treat `ASvnm4pi…` as upgradeable.

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

Production is [https://intent-protocol-wine.vercel.app](https://intent-protocol-wine.vercel.app). The slide deck is part of the same static build, at `/slides.html`, after a production deploy that contains `hackathon-demo/public/slides.html`.

To publish a later commit, from a logged-in Vercel CLI at this repository root:

```bash
npx vercel --prod
```

Do not set a Root Directory override and do not add environment variables. The output directory is `hackathon-demo/dist`.

## Track

Enter **Best Consumer App on Solana** and **Aurora Intents**. Do not enter Best Use of x402 on Solana. The reasoning is in [docs/ENCODE-SUBMISSION.md](docs/ENCODE-SUBMISSION.md). Mid-submission paste text is in [docs/ENCODE-MID-SUBMISSION.md](docs/ENCODE-MID-SUBMISSION.md).

## What is not claimed

No customers, no partners, no mainnet funds, no protocol token. The September asset is a test mint, not Circle USDC. The new demo escrows devnet SOL. Real payer, real task, and real external worker in the experiment ledger remain 0.
