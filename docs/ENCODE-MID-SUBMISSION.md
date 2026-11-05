# Encode submission fields

Deadline 2026-11-09, 19:59 Asia/Shanghai. Paste each fenced block as written. Do not add users, partners, revenue, or mainnet.

Track: Best Consumer App on Solana only. x402 is not entered. See [ENCODE-SUBMISSION.md](ENCODE-SUBMISSION.md).

## Description

```
Who it is for: a client paying a freelancer for one deliverable, and the freelancer doing that work. The live sample is Northwind Coffee hiring a writer for a homepage headline.

What pain: the client fears paying for work that only looks done. The freelancer fears the standard moving after delivery.

What Solana does: the pay is SOL in an account the program owns, not a balance in a database. The frozen “done” rule is a hash on the intent account, not copy the website can edit later. Settlement is the program paying that escrow once. A wrong headline leaves the SOL locked. A second settle is rejected on-chain.

What works live today: https://intent-protocol-wine.vercel.app — submit “Northwind Coffee: order ahead.” and the pay stays locked; submit “Northwind Coffee: order ahead, skip the line.” and it is paid once. Video: https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4 Slides: https://intent-protocol-wine.vercel.app/slides.html Program: 7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F on devnet.

No users, partners, revenue, or mainnet. Real external payer, task, and worker recorded in this repository: 0. Interview quote: TBD.
```

## Code

```
https://github.com/xqw1377-prog/INTENT-PROTOCOL

What to look at:
- hackathon-demo/ — freelance payment demo (post a bounty, submit a headline, pay once)
- hackathon-demo/public/slides.html — judge slide deck
- packages/hackathon-escrow/program/src/lib.rs — devnet escrow program (unchanged by this copy pass)
- packages/hackathon-escrow/src/index.ts — browser codec and the Northwind Coffee sample text
- HACKATHON.md — program id and Explorer links
- docs/DEMO-SCRIPT.md — 2–3 minute re-record shot list

The September program ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F lives under packages/solana-devnet-adapter. This hackathon did not modify it.
```

## Live Demo

```
https://intent-protocol-wine.vercel.app

How to try:
1. Open the URL. The first screen says “Pay for freelance work without moving the goalposts.” and “Devnet · no real money”.
2. If Phantom is not installed, the only primary button is Install Phantom. Then connect it and switch the wallet to Devnet.
3. If the balance is low, press Airdrop 1 SOL. If that is busy, use https://faucet.solana.com.
4. Post the bounty. It is prefilled: Northwind Coffee hiring a writer. Locked pay is 0.05 practice SOL. The agreed headline is “Northwind Coffee: order ahead, skip the line.”
5. Submit “Northwind Coffee: order ahead.” Then Check and pay. The pay stays locked.
6. Submit “Northwind Coffee: order ahead, skip the line.” Then Check and pay. Open the Explorer link. Paying again is rejected.
```

## Demo Video

```
https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4

Northwind Coffee freelance bounty. About 104 seconds, H.264, 1280×720. File: hackathon-demo/public/INTENT-Encode-demo.mp4. A 2–3 minute re-record shot list is docs/DEMO-SCRIPT.md. This change does not replace the mp4.
```

## Slides

```
https://intent-protocol-wine.vercel.app/slides.html

Seven slides. Opens on “Pay for freelance work without moving the goalposts.” File: hackathon-demo/public/slides.html. Served at /slides.html from the same static build as the demo.
```
