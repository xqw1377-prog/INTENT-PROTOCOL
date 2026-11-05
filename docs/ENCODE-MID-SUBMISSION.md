# Encode submission fields

Deadline 2026-11-09, 19:59 Asia/Shanghai. Paste each fenced block as written. Do not add users, partners, revenue, or mainnet.

Track: Best Consumer App on Solana only. x402 is not entered. See [ENCODE-SUBMISSION.md](ENCODE-SUBMISSION.md).

## Description

```
A safer way to pay for work. Hire someone without moving the goalposts: freeze what “done” means before the work starts, then prove the outcome after.

On the public devnet demo, a cafe posts a paid writing bounty and locks 0.05 practice SOL with the job. A writer turns in a headline. The short line “Northwind Coffee: order ahead.” does not get paid. The agreed line “Northwind Coffee: order ahead, skip the line.” is paid once. A second pay is rejected. The cafe can cancel before the check and take the pay back.

Demo: https://intent-protocol-wine.vercel.app
Video: the file at https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4 is the earlier arithmetic sample. The finals shot list is docs/DEMO-SCRIPT.md. A new hosted video URL is not recorded yet.
Slides: https://intent-protocol-wine.vercel.app/slides.html
Escrow program on devnet: 7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F

Use Phantom on Devnet, Solana’s free practice network. The sample job is one homepage headline for Northwind Coffee.

No mainnet. No token. No claimed users, customers, or partners. Real external payer, task, and worker recorded in this repository: 0.
```

## Code

```
https://github.com/xqw1377-prog/INTENT-PROTOCOL

What to look at:
- hackathon-demo/ — public wallet demo (create, submit, verify, settle)
- hackathon-demo/public/slides.html — judge slide deck
- packages/hackathon-escrow/program/src/lib.rs — devnet escrow program
- packages/hackathon-escrow/src/index.ts — the same account layout in the browser
- HACKATHON.md — program ids and Explorer links
- docs/DEMO-SCRIPT.md — narration for the demo video

The September program ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F lives under packages/solana-devnet-adapter. This hackathon did not modify it.
```

## Live Demo

```
https://intent-protocol-wine.vercel.app

How to try:
1. Open the URL. Install Phantom and switch the wallet to Devnet. Devnet is Solana’s free practice network, not real money.
2. If the balance is low, press Get practice SOL, or use https://faucet.solana.com.
3. Post bounty is prefilled. Northwind Coffee is hiring a writer for one homepage headline. The locked pay is 0.05 practice SOL. The agreed headline is “Northwind Coffee: order ahead, skip the line.”
4. Submit “Northwind Coffee: order ahead.” Then Check and pay. The pay stays locked.
5. Submit “Northwind Coffee: order ahead, skip the line.” Then Check and pay. Open the Explorer link. Paying again is rejected.
6. One wallet can play the cafe and the writer. The check does not care who signed.
```

## Demo Video

```
Previous cut (arithmetic sample, 104 seconds): https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4

Do not submit that file as the finals video. It shows 17 + 25.

Finals video URL: (record from docs/DEMO-SCRIPT.md, then paste the hosted URL)

Shot list and narration: docs/DEMO-SCRIPT.md in https://github.com/xqw1377-prog/INTENT-PROTOCOL
```

## Slides

```
https://intent-protocol-wine.vercel.app/slides.html

The deck is hackathon-demo/public/slides.html in https://github.com/xqw1377-prog/INTENT-PROTOCOL. The live site serves that file from the same static build as the demo. If /slides.html is not on production yet, open the HTML file from the repository. It is one self-contained document.
```
