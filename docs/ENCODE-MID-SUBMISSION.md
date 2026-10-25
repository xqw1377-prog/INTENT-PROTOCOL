# Encode mid-submission fields

Due 2026-11-02, 19:59 Asia/Shanghai. Paste each fenced block as written. Do not add users, partners, revenue, or mainnet.

Tracks: Best Consumer App on Solana, and Aurora Intents. x402 is not entered. See [ENCODE-SUBMISSION.md](ENCODE-SUBMISSION.md).

## Description

```
People who pay for work and people who do the work still argue about what “done” meant, because that rule was never frozen before the work started. Intent Protocol freezes the done-criteria first, escrows the reward in a Solana program, and lets the program — not the deliverer — decide whether the submission earned it.

On the public devnet demo, a wallet connects, writes the criteria, and locks 0.05 SOL in a program-owned vault in that same transaction. The criteria text and its hash sit on the intent account. The expected submission is stored only as a hash. A deliverer submits bytes. The program recomputes sha256. A match writes a verification result and pays the vault once. A wrong submission leaves the SOL locked. A second settle is rejected. The creator can cancel before verification and take the escrow back.

The demo is https://intent-protocol-wine.vercel.app. Use Phantom or Solflare on Devnet. The sample criteria are the decimal sum of 17 and 25. The answer that earns the escrow is 42.

Escrow program on devnet: 7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F. It is deployed. A sample settlement and the deploy transaction are linked from the repository. An older program, ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F, is immutable and was not modified. It still shows one test-token receipt settled once, and later retries rejected with custom error 108.

No mainnet. No protocol token. No claimed users, customers, or partners. Real external payer, task, and worker recorded in this repository: 0.
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
Video URL: (fill in after recording)

Script: docs/DEMO-SCRIPT.md in https://github.com/xqw1377-prog/INTENT-PROTOCOL

Record about 3 minutes. English narration can be text-to-speech. The founder does not need to speak. Show the live demo: freeze the sample done-criteria, submit a wrong answer, then submit 42, verify, and open the devnet Explorer settlement. Do not claim users, partners, mainnet, or a token.
```

## Slides

```
https://intent-protocol-wine.vercel.app/slides.html

The deck is hackathon-demo/public/slides.html in https://github.com/xqw1377-prog/INTENT-PROTOCOL. The live site serves that file from the same static build as the demo. If /slides.html is not on production yet, open the HTML file from the repository. It is one self-contained document.
```
