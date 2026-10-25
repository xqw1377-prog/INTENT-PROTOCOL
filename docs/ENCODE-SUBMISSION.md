# Encode Club submission fields

Paste these. Replace the two placeholders after the website and the video exist. Do not add claims that are not in the repository.

## Project name

Intent Protocol

## One-liner

Freeze the done-criteria and escrow the reward on Solana devnet, then let the program — not the deliverer — settle that reward once.

## Description

Intent is a consumer flow for paid work where “done” has to be frozen before the work starts.

A person connects a devnet wallet, writes the done-criteria, and locks SOL in a program-owned vault in that same transaction. The criteria text and its hash are stored on the intent account. The expected submission is stored only as a hash. A deliverer submits the work. The program recomputes the hash. A match writes a verification result and pays the vault to that deliverer once. A mismatch leaves the SOL in escrow. The creator can cancel before verification and take it back.

The demo is a public web app at https://intent-protocol-wine.vercel.app: Phantom or Solflare, devnet airdrop or faucet, a sample intent (17 + 25, answer 42, 0.05 SOL), and Explorer links for every transaction.

An older immutable devnet program, from September 2026, still shows a separate proof: one pre-authorized test-token receipt settled once, and later retries failed on-chain with custom error 108. That program was not modified for this hackathon.

No mainnet. No protocol token. No claimed users, customers, or partners. Real external payer, task, and worker recorded in this repository: 0.

## Track

Best Consumer App on Solana, and Aurora Intents.

## Why these tracks, and not x402

x402 is a payment-to-access protocol: a server answers HTTP 402, a client pays, and a successful payment unlocks a resource. Failed payment must not unlock it.

That is a real Solana pattern, and it is a poor fit for this product.

The payment in Intent is conditional escrow. The SOL is locked at the start and released only after the frozen rule passes. It is not a toll to read an API. Charging x402 “to run verification” would put a second payment in front of a check the program already does, and it would need a facilitator, a paid endpoint, and a failure policy that is not the product. That is too much to do honestly before the 2026-11-01 checkpoint, on top of the wallet flow the submission actually requires.

Best Consumer App matches what is built: a user need (rules that cannot move after delivery), onboarding (wallet, devnet faucet, sample data), meaningful Solana use (escrow, on-chain criteria hash, on-chain verification result, exactly-once settlement), and a working end-to-end devnet path.

Aurora Intents is the second track. The product is an intent: a frozen done-criteria, a bound reward, and a program that accepts or refuses the delivery. Enter both. Do not drop the consumer track. The demo was built to meet those criteria.

## Repository

https://github.com/xqw1377-prog/INTENT-PROTOCOL

## Demo link

https://intent-protocol-wine.vercel.app

## Video link

`(paste the hosted video URL after recording. Script: docs/DEMO-SCRIPT.md)`

## Slides

https://intent-protocol-wine.vercel.app/slides.html

Source file: `hackathon-demo/public/slides.html`. That path is on the live site after the production build includes this file. Mid-submission paste text, including a copy of these fields, is in [ENCODE-MID-SUBMISSION.md](ENCODE-MID-SUBMISSION.md).

## Tech stack

TypeScript, Node.js 22, Vite, `@solana/web3.js`, Phantom and Solflare on devnet. The new on-chain program is Rust (`solana-program` 1.18), program id `7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F`, deployed on devnet on 2026-10-25. The pre-existing protocol is a TypeScript monorepo with Vitest. No token, no mainnet RPC.

## What existed before 2026-10-12

- Off-chain protocol and local golden path, including a third-party proof pack (`packages/gp5-proof-pack`).
- Devnet program `ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F`, deployed in late September 2026, later made immutable. One receipt, 10 test tokens, exactly once. Retries fail with custom error 108.
- Loopback experiment UI and portable verifier (2026-10-03).
- Repository health CI (2026-10-11).

## What was built during the hackathon

From 2026-10-12 to 2026-10-24: product copy, local UI expression, recruitment notes, and CI repairs. No new program. No completed external experiment.

From 2026-10-25, for the November 1 checkpoint:

- New program `7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F`, deployed on devnet on 2026-10-25: escrow at intent creation, on-chain criteria hash, on-chain verification result, exactly-once SOL settlement, cancel-before-verify. A devnet run rejected submission `41` (custom 207), settled `42`, and rejected a second settle (custom 208).
- Public wallet demo at https://intent-protocol-wine.vercel.app.
- This form, the judge brief, the slide deck, and the narration script.

## Built during the hackathon

Same split as the section above. Use that text if the form has a single changelog box.
