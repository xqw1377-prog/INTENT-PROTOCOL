/**
 * TESTNET-R1 T2 devnet client — builds, submits, and observes the frozen
 * release settlement. The Adapter remains: NO settlement authority, NO
 * verifier, NO economic policy. Every frozen constant is re-checked by the
 * ON-CHAIN program; this client only conveys an already-authorized result.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assertNotMainnet, PINNED } from "./frozen.ts";
import { assertEscrowRefDomain } from "../../production-guards/src/escrow-ref-domain.ts";
import { releasePda, toHex, economicReleaseDigest } from "./index.ts";

// frozen source ATA (Appendix A; treasury ATA is the escrow source)
const TREASURY_ATA = "B7zaiMDacLZr93ERW882CZ8pK2BrQdj7UP845JpFDEUm";

export function devnetConnection(endpoint = process.env.SOLANA_RPC ?? clusterApiUrl("devnet")): Connection {
  assertNotMainnet(endpoint);
  if (/testnet(?!\S)|localhost|127\.0\.0\.1/.test(endpoint) && !/devnet/.test(endpoint)) {
    // keep the frozen-cluster discipline visible at the transport layer
    throw new Error(`endpoint is not devnet: ${endpoint}`);
  }
  return new Connection(endpoint, "confirmed");
}

export interface ReleaseTargets {
  escrowRef: string;
  outcomeReceiptHash: string;
}

/** Program instruction data: [0][u16 len][escrow_ref][receipt raw32].
 *  PH-04R: the UNTRUSTED escrow_ref passes the input-domain guard BEFORE it
 *  can reach the settlement instruction bytes / settlementKey preimage —
 *  NFC/NFD-ambiguous refs are rejected at this boundary, no bypass path. */
export function releaseInstructionData({ escrowRef, outcomeReceiptHash }: ReleaseTargets): Uint8Array {
  assertEscrowRefDomain(escrowRef); // production boundary — throws before any byte is built
  const receiptRaw = Buffer.from(outcomeReceiptHash.slice(7), "hex");
  if (escrowRef.length > 0xffff) throw new Error("escrow_ref too long");
  const data = Buffer.alloc(1 + 2 + escrowRef.length + 32);
  data.writeUInt8(0, 0);
  data.writeUInt16LE(escrowRef.length, 1);
  data.write(escrowRef, 3, "utf8");
  receiptRaw.copy(data, 3 + escrowRef.length);
  return data;
}

export interface ReleaseKeys {
  operator: Keypair;
  treasury: Keypair;
}

/** Build the release transaction (caller signs with operator + treasury). */
export async function buildReleaseTx(
  connection: Connection,
  programId: string,
  targets: ReleaseTargets,
  keys: ReleaseKeys,
  variation?: bigint,
): Promise<{ tx: Transaction; releasePda: string; digest: string }> {
  assertEscrowRefDomain(targets.escrowRef); // PH-04R chain boundary (pre-tx, no bypass)
  const digestHex = toHex(economicReleaseDigest(targets.escrowRef, targets.outcomeReceiptHash));
  const { pda } = releasePda(targets.escrowRef, targets.outcomeReceiptHash, programId);
  const caps = PublicKey.findProgramAddressSync([Buffer.from("caps")], new PublicKey(programId))[0].toBase58();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const ix = new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(pda), isSigner: false, isWritable: true },          // 0 release PDA
      { pubkey: keys.operator.publicKey, isSigner: true, isWritable: false },     // 1 operator
      { pubkey: keys.treasury.publicKey, isSigner: true, isWritable: false },     // 2 treasury
      // destination + source + mint + caps + programs are FROZEN — the client
      // passes them through, the program re-validates every one:
      { pubkey: new PublicKey(PINNED.claimantTokenAccount!), isSigner: false, isWritable: true },   // 3 claimant ATA (frozen)
      { pubkey: new PublicKey(TREASURY_ATA), isSigner: false, isWritable: true },   // 4 treasury ATA (frozen)
      { pubkey: new PublicKey(PINNED.mint!), isSigner: false, isWritable: false },  // 5 mint (frozen)
      { pubkey: new PublicKey(caps), isSigner: false, isWritable: true },         // 6 caps PDA
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },           // 7 token program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },  // 8 system program
    ],
    data: Buffer.from(releaseInstructionData(targets)),
  });
  const tx = new Transaction({ feePayer: keys.treasury.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ix);
  if (variation !== undefined && variation > 0n) {
    // auxiliary client-side variety (nonce/memo stand-in) — a treasury
    // self-transfer of a distinct lamport amount; the SPL Memo program does
    // not exist on devnet, and auxiliary data must NEVER touch the release
    tx.add(SystemProgram.transfer({
      fromPubkey: keys.treasury.publicKey,
      toPubkey: keys.treasury.publicKey,
      lamports: variation,
    }));
  }
  tx.sign(keys.operator, keys.treasury);
  return { tx, releasePda: pda, digest: digestHex };
}

export interface SettlementObservation {
  slot: number;
  claimantAtaBalance: string;
  treasuryAtaBalance: string;
  releasePda: { exists: boolean; initialized: boolean; amountBase: string | null; slot: string | null };
  capsPda: { exists: boolean; cycleReleasedBase: string | null };
}

/** Observe chain truth only — no local state participates (T2-06 semantics). */
export async function observeSettlement(connection: Connection, programId: string, targets: ReleaseTargets): Promise<SettlementObservation> {
  const { pda } = releasePda(targets.escrowRef, targets.outcomeReceiptHash, programId);
  const caps = PublicKey.findProgramAddressSync([Buffer.from("caps")], new PublicKey(programId))[0];
  const [slot, claimant, treasury, releaseInfo, capsInfo] = await Promise.all([
    connection.getSlot("confirmed"),
    connection.getTokenAccountBalance(new PublicKey(PINNED.claimantTokenAccount!), "confirmed"),
    connection.getTokenAccountBalance(new PublicKey(TREASURY_ATA), "confirmed"),
    connection.getAccountInfo(new PublicKey(pda), "confirmed"),
    connection.getAccountInfo(caps, "confirmed"),
  ]);
  const releaseInitialized = !!releaseInfo && releaseInfo.data.length >= 146 && releaseInfo.data[0] === 1;
  const capsOk = !!capsInfo && capsInfo.data.length >= 9 && capsInfo.data[0] === 1;
  return {
    slot,
    claimantAtaBalance: claimant.value.amount,
    treasuryAtaBalance: treasury.value.amount,
    releasePda: {
      exists: !!releaseInfo,
      initialized: releaseInitialized,
      amountBase: releaseInitialized ? releaseInfo.data.readBigUInt64LE(129).toString() : null,
      slot: releaseInitialized ? releaseInfo.data.readBigUInt64LE(137).toString() : null,
    },
    capsPda: { exists: !!capsInfo, cycleReleasedBase: capsOk ? capsInfo.data.readBigUInt64LE(1).toString() : null },
  };
}
