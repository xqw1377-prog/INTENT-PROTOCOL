# Demo video script

Finals shot list. About 3 minutes. English narration for text-to-speech. The founder does not need to speak.

The file already hosted at [https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4](https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4) is the earlier arithmetic sample (17 + 25). Do not submit that cut for the finals. Record this script, then paste the new hosted URL into `docs/ENCODE-MID-SUBMISSION.md`.

Track: Best Consumer App on Solana. Do not mention other tracks. Do not claim users, partners, mainnet, or a token. Say “practice SOL” when you mention the pay.

## Shot list

| Time | On screen | Say |
|---|---|---|
| 0:00–0:25 | Live demo headline, no scrolling | A cafe and a writer can still fight about the headline after the draft is in, because “done” was never frozen. |
| 0:25–0:50 | Three cards | Intent locks the job and the pay before writing starts. A matching headline is paid once. A short one is not. |
| 0:50–1:15 | Connect Phantom. Point at Devnet. | This wallet is Phantom. The network is Devnet, Solana’s free practice network. The site never asks for a secret phrase. Press Get practice SOL if the balance is empty. |
| 1:15–1:45 | Post bounty form, already filled | Northwind Coffee is hiring a writer for one homepage headline. The job text and the agreed line are filled in. The pay is 0.05 practice SOL. Post the bounty. The page then shows Funded. |
| 1:45–2:15 | Submit the short line, then Check and pay | The short line is “Northwind Coffee: order ahead.” The check fails. The pay stays locked. |
| 2:15–2:45 | Submit the full line, then Check and pay. Open Explorer. | The agreed line is “Northwind Coffee: order ahead, skip the line.” The pay goes out once. The Explorer link is the public record. Paying again is rejected. |
| 2:45–3:00 | Header program link, or README “Built during the hackathon” | There are no claimed customers. The pay is practice SOL. An older one-receipt program was not changed. |

## Before you hit record

1. Production page: [https://intent-protocol-wine.vercel.app](https://intent-protocol-wine.vercel.app). The headline must say “A safer way to pay for work.” The sample job must name Northwind Coffee. If it still asks for 17 + 25, the new build is not deployed yet.
2. Phantom is installed, unlocked, and set to **Devnet**.
3. The wallet holds at least 0.2 practice SOL. If Get practice SOL fails, use [faucet.solana.com](https://faucet.solana.com) first.
4. Zoom so the headline fits. Hide the bookmarks bar. Do not show a seed phrase.
5. One wallet is enough. It can play the cafe and the writer.

Local fallback:

```bash
cd hackathon-demo
npm ci
npm run dev
# http://127.0.0.1:4173
```

## 0:00–0:25 Problem

On screen: the top of the page. Do not scroll yet.

Narration:

“A cafe can hire a writer, and still argue about the headline after the draft arrives. The person paying does not want to pay for a line that missed the brief. The writer does not want the brief to change after they deliver.”

## 0:25–0:50 Solution

On screen: the three cards.

Narration:

“This is a safer way to pay for work. The cafe freezes the job and locks the pay before the writing starts. If the headline matches what was agreed, it is paid once. If it is short, the pay stays locked.”

## 0:50–1:15 Connect and fund

On screen: Connect Phantom. Point at the wallet network so Devnet is visible. If the balance is low, click Get practice SOL. Do not show a seed phrase.

Narration:

“Phantom is the wallet. Devnet is Solana’s practice network, so this is not real money. The site asks the wallet to sign. It never asks for the secret phrase. Practice SOL comes from the button, or from the public faucet.”

## 1:15–1:45 Post the bounty

On screen: Post bounty. Point at the job text, then at the agreed headline `Northwind Coffee: order ahead, skip the line.`, then at 0.05. Click Post bounty and lock pay. Approve. Wait until the bounty page says Funded.

Narration:

“Northwind Coffee is hiring a writer for one homepage headline. The job and the agreed line are already filled in. Point zero five practice SOL is locked with the bounty. After this, the cafe cannot swap the headline.”

## 1:45–2:15 A short headline

On screen: type `Northwind Coffee: order ahead.` and click Submit headline. Approve. Then click Check and pay. Approve. Leave the error up.

Narration:

“The writer turns in a shorter line. The check fails. The pay stays locked. A draft that missed the brief does not get paid.”

## 2:15–2:45 The agreed headline

On screen: submit `Northwind Coffee: order ahead, skip the line.` Click Check and pay. Wait for the settled state. Open the Explorer link. Show Devnet and success.

Narration:

“The agreed headline passes. The locked pay goes to the writer, once. The Explorer page is the public record. Paying this same bounty again is rejected.”

## 2:45–3:00 Limits

On screen: the program link in the header, or the README section “Built during the hackathon”.

Narration:

“There are no claimed customers, and this is not mainnet. The older settlement program was not changed. What this demo adds is a bounty a new person can post, deliver, and see paid once.”

## If a step fails on camera

- Get practice SOL is rate-limited: use the faucet, then continue. Say that out loud.
- Wallet on the wrong network: switch to Devnet and retry the same click. Do not edit the bounty mid-take.
- Do not improvise a customer count, a dollar price, or a mainnet address.
