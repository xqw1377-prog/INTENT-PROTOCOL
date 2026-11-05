/**
 * End-to-end check against solana-test-validator (or devnet, if SOLANA_RPC is set).
 * Not part of CI. Usage, with the validator already running and the program loaded:
 *   node --experimental-strip-types scripts/local-roundtrip.ts
 */
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  IX_CREATE,
  PROGRAM_ID,
  SAMPLE_ANSWER,
  SAMPLE_CRITERIA,
  SAMPLE_WRONG,
  SAMPLE_LAMPORTS,
  SEED_INTENT,
  SEED_REGISTRY,
  SEED_VAULT,
  STATUS_SETTLED,
  decodeIntent,
  encodeCancel,
  encodeCreate,
  encodeSettle,
  encodeSubmit,
  encodeVerify,
  hashUtf8,
} from "../../packages/hackathon-escrow/src/index.ts";

const RPC = process.env.SOLANA_RPC ?? "http://127.0.0.1:8899";
const PROGRAM = new PublicKey(PROGRAM_ID);
const connection = new Connection(RPC, "confirmed");

function pda(seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];
}

function nonceBytes(nonce: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, nonce, true);
  return out;
}

async function send(payer: Keypair, instructions: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...instructions);
  tx.sign(payer);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) throw new Error(JSON.stringify(result.value.err));
  return signature;
}

function ix(data: Uint8Array, keys: TransactionInstruction["keys"]): TransactionInstruction {
  return new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.from(data) });
}

async function expectFail(label: string, codes: number[], work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
    const code = hex ? Number.parseInt(hex[1], 16) : null;
    const decimal = text.match(/"Custom":\s*(\d+)/);
    const decimalCode = decimal ? Number(decimal[1]) : null;
    const hit = codes.some((wanted) => code === wanted || decimalCode === wanted || text.includes(String(wanted)));
    if (!hit) {
      throw new Error(`${label} failed for an unexpected reason: ${text}`);
    }
    console.log("expected failure", label, code ?? decimalCode);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function main(): Promise<void> {
  if (IX_CREATE !== 1) throw new Error("codec drift");
  const info = await connection.getAccountInfo(PROGRAM);
  if (!info?.executable) throw new Error(`program ${PROGRAM_ID} is not executable at ${RPC}`);

  const payerPath = process.env.SOLANA_KEYPAIR;
  const payer = payerPath
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8")) as number[]))
    : Keypair.generate();
  if (!payerPath) {
    const sig = await connection.requestAirdrop(payer.publicKey, 2_000_000_000);
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  }
  console.log("payer", payer.publicKey.toBase58());

  const nonce = BigInt(Date.now());
  const intent = pda([SEED_INTENT, payer.publicKey.toBytes(), nonceBytes(nonce)]);
  const vault = pda([SEED_VAULT, intent.toBytes()]);
  const registry = pda([SEED_REGISTRY]);
  const created = await send(payer, [
    ix(encodeCreate({ nonce, lamports: SAMPLE_LAMPORTS, expectedHash: hashUtf8(SAMPLE_ANSWER), criteria: SAMPLE_CRITERIA }), [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: intent, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: registry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  ]);
  console.log("created", created, intent.toBase58());

  const deliverer = Keypair.generate();
  const fund = await send(payer, [
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: deliverer.publicKey, lamports: 20_000_000 }),
  ]);
  console.log("funded deliverer", fund);

  await expectFail("wrong submission must not settle", [207], async () => {
    await send(deliverer, [
      ix(encodeSubmit(SAMPLE_WRONG), [
        { pubkey: deliverer.publicKey, isSigner: true, isWritable: true },
        { pubkey: intent, isSigner: false, isWritable: true },
      ]),
    ]);
    await send(payer, [
      ix(encodeVerify(), [{ pubkey: intent, isSigner: false, isWritable: true }]),
      ix(encodeSettle(), [
        { pubkey: intent, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: deliverer.publicKey, isSigner: false, isWritable: true },
      ]),
    ]);
  });

  const submitted = await send(deliverer, [
    ix(encodeSubmit(SAMPLE_ANSWER), [
      { pubkey: deliverer.publicKey, isSigner: true, isWritable: true },
      { pubkey: intent, isSigner: false, isWritable: true },
    ]),
  ]);
  const settled = await send(payer, [
    ix(encodeVerify(), [{ pubkey: intent, isSigner: false, isWritable: true }]),
    ix(encodeSettle(), [
      { pubkey: intent, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: deliverer.publicKey, isSigner: false, isWritable: true },
    ]),
  ]);
  console.log("submitted", submitted);
  console.log("settled", settled);

  const after = await connection.getAccountInfo(intent);
  const decoded = after ? decodeIntent(new Uint8Array(after.data)) : null;
  if (decoded?.status !== STATUS_SETTLED) throw new Error(`status ${decoded?.status}`);
  if (decoded.submission !== SAMPLE_ANSWER) throw new Error("submission not stored");
  const delivererBalance = await connection.getBalance(deliverer.publicKey);
  if (delivererBalance < Number(SAMPLE_LAMPORTS)) throw new Error(`deliverer balance ${delivererBalance}`);

  await expectFail("second settle", [208], async () => {
    await send(payer, [
      ix(encodeSettle(), [
        { pubkey: intent, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: deliverer.publicKey, isSigner: false, isWritable: true },
      ]),
    ]);
  });

  const creator = Keypair.generate();
  const air = await connection.requestAirdrop(creator.publicKey, 1_000_000_000);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: air, ...latest }, "confirmed");
  const nonce2 = nonce + 1n;
  const intent2 = pda([SEED_INTENT, creator.publicKey.toBytes(), nonceBytes(nonce2)]);
  await send(creator, [
    ix(encodeCreate({ nonce: nonce2, lamports: SAMPLE_LAMPORTS, expectedHash: hashUtf8("x"), criteria: "Cancel me." }), [
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: intent2, isSigner: false, isWritable: true },
      { pubkey: pda([SEED_VAULT, intent2.toBytes()]), isSigner: false, isWritable: true },
      { pubkey: registry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  ]);
  const beforeCancel = await connection.getBalance(creator.publicKey);
  await send(creator, [
    ix(encodeCancel(), [
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: intent2, isSigner: false, isWritable: true },
      { pubkey: pda([SEED_VAULT, intent2.toBytes()]), isSigner: false, isWritable: true },
    ]),
  ]);
  const afterCancel = await connection.getBalance(creator.publicKey);
  if (afterCancel <= beforeCancel) throw new Error(`cancel did not return escrow (${beforeCancel} -> ${afterCancel})`);
  console.log("cancel returned lamports", afterCancel - beforeCancel);
  console.log("ROUNDTRIP OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
