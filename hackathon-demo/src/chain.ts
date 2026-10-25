import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
  TransactionInstruction as TxIx,
} from "@solana/web3.js";
import {
  DEVNET_GENESIS,
  DEVNET_RPC,
  ERROR_TEXT,
  PROGRAM_ID,
  REGISTRY_LEN,
  SEED_INTENT,
  SEED_REGISTRY,
  SEED_VAULT,
  decodeIntent,
  decodeRegistry,
  encodeCancel,
  encodeCreate,
  encodeSettle,
  encodeSubmit,
  encodeVerify,
  type DecodedIntent,
} from "@intent/hackathon-escrow";

export const PROGRAM = new PublicKey(PROGRAM_ID);
export const connection = new Connection(DEVNET_RPC, "confirmed");

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export function registryPda(): PublicKey {
  return PublicKey.findProgramAddressSync([SEED_REGISTRY], PROGRAM)[0];
}

export function intentPda(creator: PublicKey, nonce: bigint): PublicKey {
  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, nonce, true);
  return PublicKey.findProgramAddressSync([SEED_INTENT, creator.toBytes(), nonceBytes], PROGRAM)[0];
}

export function vaultPda(intent: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEED_VAULT, intent.toBytes()], PROGRAM)[0];
}

export async function assertDevnet(): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) {
    throw new Error("Refusing to continue: the RPC is not Solana devnet.");
  }
}

export async function programIsDeployed(): Promise<boolean> {
  const info = await connection.getAccountInfo(PROGRAM);
  return info !== null && info.executable;
}

function ix(data: Uint8Array, keys: TxIx["keys"]): TransactionInstruction {
  return new TxIx({ programId: PROGRAM, keys, data: Buffer.from(data) });
}

export function createInstructions(args: {
  creator: PublicKey;
  nonce: bigint;
  lamports: bigint;
  expectedHash: Uint8Array;
  criteria: string;
}): TransactionInstruction[] {
  const intent = intentPda(args.creator, args.nonce);
  return [
    ix(encodeCreate(args), [
      { pubkey: args.creator, isSigner: true, isWritable: true },
      { pubkey: intent, isSigner: false, isWritable: true },
      { pubkey: vaultPda(intent), isSigner: false, isWritable: true },
      { pubkey: registryPda(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  ];
}

export function submitInstructions(deliverer: PublicKey, intent: PublicKey, submission: string): TransactionInstruction[] {
  return [
    ix(encodeSubmit(submission), [
      { pubkey: deliverer, isSigner: true, isWritable: true },
      { pubkey: intent, isSigner: false, isWritable: true },
    ]),
  ];
}

export function verifyAndSettleInstructions(intent: PublicKey, deliverer: PublicKey): TransactionInstruction[] {
  return [
    ix(encodeVerify(), [{ pubkey: intent, isSigner: false, isWritable: true }]),
    ix(encodeSettle(), [
      { pubkey: intent, isSigner: false, isWritable: true },
      { pubkey: vaultPda(intent), isSigner: false, isWritable: true },
      { pubkey: deliverer, isSigner: false, isWritable: true },
    ]),
  ];
}

export function cancelInstructions(creator: PublicKey, intent: PublicKey): TransactionInstruction[] {
  return [
    ix(encodeCancel(), [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: intent, isSigner: false, isWritable: true },
      { pubkey: vaultPda(intent), isSigner: false, isWritable: true },
    ]),
  ];
}

export async function sendInstructions(
  payer: PublicKey,
  instructions: TransactionInstruction[],
  sign: (tx: Transaction) => Promise<Transaction>,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(...instructions);
  const signed = await sign(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) {
    throw new Error(explainChainError(result.value.err));
  }
  return signature;
}

export async function loadIntent(address: string): Promise<{ address: string; account: DecodedIntent } | null> {
  const info = await connection.getAccountInfo(new PublicKey(address));
  if (!info) return null;
  const account = decodeIntent(new Uint8Array(info.data));
  if (!account) return null;
  return { address, account };
}

export async function loadBoard(): Promise<Array<{ address: string; account: DecodedIntent }>> {
  const info = await connection.getAccountInfo(registryPda());
  if (!info || info.data.length < REGISTRY_LEN) return [];
  const keys = decodeRegistry(new Uint8Array(info.data));
  if (keys.length === 0) return [];
  const infos = await connection.getMultipleAccountsInfo(keys.map((k) => new PublicKey(k)));
  const rows: Array<{ address: string; account: DecodedIntent }> = [];
  keys.forEach((key, i) => {
    const accountInfo = infos[i];
    if (!accountInfo) return;
    const account = decodeIntent(new Uint8Array(accountInfo.data));
    if (!account) return;
    rows.push({ address: new PublicKey(key).toBase58(), account });
  });
  return rows.reverse();
}

export async function recentSignatures(address: string): Promise<string[]> {
  const rows = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 8 });
  return rows.map((row) => row.signature);
}

export function explainChainError(err: unknown): string {
  const text = typeof err === "string" ? err : JSON.stringify(err);
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex?.[1]) {
    const code = Number.parseInt(hex[1], 16);
    return ERROR_TEXT[code] ?? text;
  }
  const custom = text.match(/"Custom":(\d+)/);
  if (custom?.[1]) {
    const code = Number(custom[1]);
    return ERROR_TEXT[code] ?? text;
  }
  return text;
}

export function explainUnknown(err: unknown): string {
  if (err instanceof Error) {
    const mapped = explainChainError(err.message);
    if (mapped !== err.message) return mapped;
    const logs = (err as { logs?: string[] }).logs;
    if (logs) {
      const fromLogs = explainChainError(logs.join("\n"));
      if (fromLogs !== logs.join("\n")) return fromLogs;
    }
    return err.message;
  }
  return explainChainError(err);
}
