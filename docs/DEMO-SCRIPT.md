# Demo video script

Re-record shot list, about 3 minutes. Do not treat the hosted file as this cut. The file at [https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4](https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4) is the current Northwind Coffee bounty video, about 104 seconds. This script is the 2–3 minute version to record next. This change does not re-encode that file.

Track: Best Consumer App on Solana. Do not claim users, partners, revenue, or mainnet. Say “practice SOL” and “Devnet · no real money”.

## 0:00–0:20 Conflict

On screen: the homepage. Headline: “Pay for freelance work without moving the goalposts.” Do not scroll.

Narration:

“A client hires a freelancer and then fears paying for work that only looks done. The freelancer fears the standard moving after delivery. Both of those fights start because done was never frozen.”

## 0:20–0:40 Product

On screen: the three cards. Client, freelancer, after delivery.

Narration:

“Freeze what done means before the work. Lock the reward with it. Let Solana settle once. The sample is Northwind Coffee hiring a writer for one homepage headline. After posting, that headline cannot be swapped.”

## 0:40–2:20 Live flow

On screen, in order:

1. Point at “Devnet · no real money”.
2. If Phantom is missing, the only filled button is Install Phantom. If it is installed, press Connect Phantom. Show the wallet network set to Devnet.
3. If the balance is low, press Airdrop 1 SOL. If the button is busy, open faucet.solana.com. Say that out loud.
4. Press Post the bounty. The job and the agreed line are filled in. Pay is 0.05 practice SOL. Approve. Wait for Funded.
5. Submit `Northwind Coffee: order ahead.` Press Check and pay. Leave the error up. The pay stays locked.
6. Submit `Northwind Coffee: order ahead, skip the line.` Press Check and pay. Open the Explorer link. Show success on Devnet.
7. Press Check and pay again, or say that a second pay of this same bounty is rejected. Do not edit the bounty mid-take.

Narration:

“The short headline is not the agreed one, so the pay stays locked. The full headline matches, so the program pays the locked SOL once. The Explorer page is the record. Paying this bounty again is rejected. One wallet can play the cafe and the writer.”

## 2:20–3:00 Why Solana has to be here

On screen: the program link in the header, `7a6K1m…`, then the Explorer success page if it is still open.

Narration:

“The pay is SOL in an account the program owns. It is not a balance in a database. The frozen rule is a hash on the intent account. The website cannot edit it after posting. Settlement is the program paying that escrow once. A message from a server is not the payment. There are no claimed customers, and this is not mainnet.”

## Before you hit record

1. Production page: [https://intent-protocol-wine.vercel.app](https://intent-protocol-wine.vercel.app). The headline must be the freelance line above. The label “Devnet · no real money” must be visible.
2. Phantom installed, unlocked, set to Devnet, with at least 0.2 practice SOL. Low balance uses Airdrop 1 SOL, then [faucet.solana.com](https://faucet.solana.com).
3. Zoom so the headline fits. Hide the bookmarks bar. Do not show a secret phrase.
4. Do not invent a customer count, a dollar price, or a mainnet address.

Local fallback:

```bash
cd hackathon-demo
npm ci
npm run dev
# http://127.0.0.1:4173
```
