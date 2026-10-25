# Encode Club submission fields

Paste these. Do not add claims that are not in the repository.

## Project name

Intent Protocol

## One-liner

A safer way to pay for work: hire without moving the goalposts. Freeze the rules before the work. Prove the outcome after.

## Description

A safer way to pay for work. Hire someone without moving the goalposts: freeze what “done” means before the work starts, then prove the outcome after.

On the public devnet demo, a wallet connects, writes the rule, and locks 0.05 SOL with it. A deliverer submits the work. A match pays that SOL once. Submit 41 on the sample and the pay stays locked. Submit 42 and it pays once. A second pay is rejected. The person who posted the job can cancel before the check and take the SOL back.

Demo: https://intent-protocol-wine.vercel.app
Video: https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4
Slides: https://intent-protocol-wine.vercel.app/slides.html
Escrow program on devnet: 7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F

Use Phantom or Solflare on Devnet. The sample asks for the decimal sum of 17 and 25.

No mainnet. No token. No claimed users, customers, or partners. Real external payer, task, and worker recorded in this repository: 0.

## Track

Best Consumer App on Solana.

Aurora Intents is not entered and is not qualified until there is a real Aurora Intents integration. The product name contains “intent”. That is not an integration. Do not claim the Aurora bounty.

## Why this track, and not x402 or Aurora

x402 is a payment-to-access protocol: a server answers HTTP 402, a client pays, and a successful payment unlocks a resource. Failed payment must not unlock it.

That is a real Solana pattern, and it is a poor fit for this product.

The payment in Intent is conditional escrow. The SOL is locked at the start and released only after the frozen rule passes. It is not a toll to read an API. Charging x402 “to run verification” would put a second payment in front of a check the program already does, and it would need a facilitator, a paid endpoint, and a failure policy that is not the product. That is too much to do honestly before the 2026-11-01 checkpoint, on top of the wallet flow the submission actually requires.

Best Consumer App matches what is built: a person can hire work without the rule moving after delivery, get onto devnet with a wallet and a faucet, and watch one sample job pay once. Solana holds the pay from the moment the rule is frozen.

Aurora Intents is not entered. There is no Aurora Intents integration in this repository, so the track is not qualified and the bounty is not claimed. An Aurora Intents workshop is on 2026-10-28. Decide after that workshop. Do not bolt on a cosmetic Aurora API for the bounty.

## Repository

https://github.com/xqw1377-prog/INTENT-PROTOCOL

## Demo link

https://intent-protocol-wine.vercel.app

## Video link

https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4

104 seconds, 1280×720. Source file: `hackathon-demo/public/INTENT-Encode-demo.mp4`. That URL is on the live site after the production build includes this file. An unlisted YouTube URL is not available yet. Narration script: `docs/DEMO-SCRIPT.md`.

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
