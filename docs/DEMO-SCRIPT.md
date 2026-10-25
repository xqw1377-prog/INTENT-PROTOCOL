# Demo video script

A recorded cut is in the repository: [hackathon-demo/public/INTENT-Encode-demo.mp4](../hackathon-demo/public/INTENT-Encode-demo.mp4) (104 seconds, 1280×720). After the production build includes that file, it is [https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4](https://intent-protocol-wine.vercel.app/INTENT-Encode-demo.mp4). An unlisted YouTube URL is not available yet.

The timings below are the narration for that recording. Three minutes was the script length. English narration is for text-to-speech. The founder does not need to speak. The closing proof is one Explorer tab.

Do not claim users, partners, mainnet, or a token. Say “devnet SOL” when you mention the escrow.

## Before you hit record

1. Record against the live demo, [https://intent-protocol-wine.vercel.app](https://intent-protocol-wine.vercel.app). Solana Explorer (devnet) already shows program `7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F` as deployed. Deploy transaction: `3aGkjKFgswMQgZVvn6VoZZM2Reyhs7uDTSENp2eqQaqcZVgUp3Ub5J5bCbWruqkk585KjS5NHrubgVWN1pXqbSjx`.
2. Phantom or Solflare is installed, unlocked, and set to **Devnet**.
3. The wallet holds at least 0.2 SOL. If Airdrop fails, use [faucet.solana.com](https://faucet.solana.com) first.
4. Browser at the live URL, zoomed so the headline fits. Bookmarks bar hidden. Local fallback, only if the live site is down:

```bash
cd hackathon-demo
npm ci
npm run dev
# http://127.0.0.1:4173
```
5. Have a second wallet only if you want the two-role shot. One wallet is enough: the program, not the signer, decides the result.

## 0:00–0:25 Problem

On screen: the top of the page. Do not scroll yet. Cursor still.

Narration:

“Two people can agree to work, and still fight about what done means after the work is finished. The person who pays does not want to pay for something that only looks finished. The person who does the work does not want the rules to change after they deliver.”

## 0:25–0:45 Solution

On screen: scroll until the three cards are visible. Leave them up.

Narration:

“Intent freezes the done-criteria before any work starts, and locks the reward in the same step. After delivery, the Solana program recomputes the submission. If it matches the hash that was frozen, the escrow is earned. Earned is a protocol fact. Paying it is the settlement that follows.”

## 0:45–1:05 Connect and fund

On screen: click Connect Phantom, or Solflare. Approve the connection. Point at the wallet network so Devnet is visible. If the balance is low, click Airdrop 1 devnet SOL on the create page, or show the faucet already completed. Do not show a seed phrase.

Narration:

“This is Solana devnet. The wallet signs. The site never sees a secret key. Test SOL comes from the devnet faucet. Nothing here is mainnet, and nothing here is a project token.”

## 1:05–1:35 Freeze and escrow

On screen: Create. The sample text is already filled. Point at the criteria, then at the expected submission `42`, then at `0.05` SOL. Click Freeze and escrow. Approve in the wallet. Wait until the intent page shows the status Funded. Click the intent account link only long enough to show Explorer on devnet, then come back.

Narration:

“The sample rule says done means the decimal sum of seventeen and twenty-five. The answer is committed as a hash. The words of the rule are stored on the intent account. Point zero five SOL moves into a vault the program owns. That vault is the escrow. It is created in the same transaction as the rule.”

## 1:35–2:05 A failed delivery

On screen: on the intent page, type `41` and click Submit delivery. Approve. Then click Verify and settle. Approve. Leave the error banner up. It should say the submission does not match and the escrow stays locked.

Narration:

“A wrong submission is recorded, and then the check fails. The program does not trust the deliverer. The SOL stays in the vault. Failed work does not get paid.”

## 2:05–2:35 The earned settlement

On screen: submit `42`. Then click Verify and settle. Approve. Wait for the green settled state. Scroll to the Explorer list and open the settlement transaction. Show the devnet cluster badge and the success state.

Narration:

“The matching submission passes. The program writes a verification hash, then pays the vault to the deliverer, once. The Explorer link is the public record. A second settle of this same intent is rejected on-chain.”

## 2:35–3:00 What already existed

On screen: switch to the repository README section “Built during the hackathon”, or the program line in the page header. If you have time, open the September transaction `3enZzg…` and show that it is a different, older program.

Narration:

“The idea, the local proof packs, and an immutable one-receipt settlement program were built before this hackathon. What was added for the checkpoint is this open demo: any devnet wallet can freeze a rule, escrow SOL, and settle once. There are no claimed users and no partners. The older program was not upgraded.”

## If a step fails on camera

- Airdrop rate limit: use the faucet, then continue. Say that out loud.
- Wallet on the wrong network: switch to Devnet and retry the same click. Do not edit the rule mid-take.
- Do not improvise a customer, a dollar amount, or a mainnet address.
