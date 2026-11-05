# Encode Club submission fields

Paste these. Do not add claims that are not in the repository.

## Project name

Intent Protocol

## One-liner

Pay for freelance work without moving the goalposts.

## Description

Who it is for: a client paying a freelancer for one deliverable, and the freelancer doing that work. The live sample is Northwind Coffee hiring a writer for a homepage headline.

What pain: the client fears paying for work that only looks done. The freelancer fears the standard moving after delivery.

What Solana does: the pay is SOL in an account the program owns, not a balance in a database. The frozen “done” rule is a hash on the intent account, not copy the website can edit later. Settlement is the program paying that escrow once. A wrong headline leaves the SOL locked. A second settle is rejected on-chain.

What works live today: https://intent-protocol-wine.vercel.app — submit “Northwind Coffee: order ahead.” and the pay stays locked; submit “Northwind Coffee: order ahead, skip the line.” and it is paid once. Video: https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4 Slides: https://intent-protocol-wine.vercel.app/slides.html Program: 7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F on devnet.

No users, partners, revenue, or mainnet. Real external payer, task, and worker recorded in this repository: 0. Interview quote: TBD.

## Track

Best Consumer App on Solana.

## Why this track, and not x402

x402 is a payment-to-access protocol: a server answers HTTP 402, a client pays, and a successful payment unlocks a resource. Failed payment must not unlock it.

That is a real Solana pattern, and it is a poor fit for this product.

The payment in Intent is conditional escrow. The SOL is locked at the start and released only after the frozen rule passes. It is not a toll to read an API. Charging x402 “to run verification” would put a second payment in front of a check the program already does, and it would need a facilitator, a paid endpoint, and a failure policy that is not the product. That is too much to do honestly before the 2026-11-01 checkpoint, on top of the wallet flow the submission actually requires.

Best Consumer App matches what is built: a cafe can hire a writer without changing the headline after the draft arrives, a new person can start with a browser wallet and free practice SOL, and one sample bounty pays once.

x402 is not entered. That pattern unlocks access after a payment. This payment waits until the frozen job is met.

## Repository

https://github.com/xqw1377-prog/INTENT-PROTOCOL

## Demo link

https://intent-protocol-wine.vercel.app

## Video link

https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4

Northwind Coffee bounty judge cut, 166 seconds, H.264, 1280×720. Source file: `hackathon-demo/public/INTENT-Encode-demo.mp4`. Shot list: `docs/DEMO-SCRIPT.md`.

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
