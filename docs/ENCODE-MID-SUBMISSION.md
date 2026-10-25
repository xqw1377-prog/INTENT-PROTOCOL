# Encode mid-submission fields

Due 2026-11-02, 19:59 Asia/Shanghai. Paste each fenced block as written. Do not add users, partners, revenue, or mainnet.

Track: Best Consumer App on Solana. Aurora Intents is not entered and is not qualified until a real Aurora Intents integration exists. Do not claim the Aurora bounty. An Aurora Intents workshop is on 2026-10-28; decide after it, and do not add a cosmetic Aurora API for the bounty. x402 is not entered. See [ENCODE-SUBMISSION.md](ENCODE-SUBMISSION.md).

## Description

```
A safer way to pay for work. Hire someone without moving the goalposts: freeze what “done” means before the work starts, then prove the outcome after.

On the public devnet demo, a wallet connects, writes the rule, and locks 0.05 SOL with it. A deliverer submits the work. A match pays that SOL once. Submit 41 on the sample and the pay stays locked. Submit 42 and it pays once. A second pay is rejected. The person who posted the job can cancel before the check and take the SOL back.

Demo: https://intent-protocol-wine.vercel.app
Video: https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4
Slides: https://intent-protocol-wine.vercel.app/slides.html
Escrow program on devnet: 7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F

Use Phantom or Solflare on Devnet. The sample asks for the decimal sum of 17 and 25.

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
1. Open the URL. Install Phantom or Solflare and switch the wallet to Devnet.
2. If the balance is low, use Airdrop on the page, or https://faucet.solana.com.
3. Create is prefilled. The sample criteria are the decimal sum of 17 and 25. Escrow is 0.05 SOL. The answer that earns it is 42.
4. Submit 41, then Verify and settle. The program rejects it. The SOL stays in the vault.
5. Submit 42, then Verify and settle. Open the Explorer link on the page. Settling again is rejected.
6. One wallet is enough. The program, not the signer, decides the result.
```

## Demo Video

```
https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4

104 seconds, 1280×720. The file is hackathon-demo/public/INTENT-Encode-demo.mp4 in https://github.com/xqw1377-prog/INTENT-PROTOCOL. The live site serves that path after the production build includes this file. An unlisted YouTube URL is not available yet. Narration script: docs/DEMO-SCRIPT.md.
```

## Slides

```
https://intent-protocol-wine.vercel.app/slides.html

The deck is hackathon-demo/public/slides.html in https://github.com/xqw1377-prog/INTENT-PROTOCOL. The live site serves that file from the same static build as the demo. If /slides.html is not on production yet, open the HTML file from the repository. It is one self-contained document.
```
