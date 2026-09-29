/**
 * TESTNET-R1 frozen constants (docs/TESTNET-R1.md §3, Appendix A).
 *
 * T1 scope: NOTHING here may be resolved dynamically. No discovery, no
 * defaults, no env overrides — unpinned means DENY.
 */

export const FROZEN = {
  network: "solana-devnet",
  asset: { network: "solana-devnet", asset: "USDC-test", decimals: 6 },
  amount: "10",
  /** Grounding anchors already frozen by GP3/GP4/GP5 (referenced, not redefined). */
  anchors: {
    escrowRef: "escrow:gp-001-local",
    outcomeReceiptHash: "sha256:da577b3d04bc53dac6ace4c200679ab36bc1fa21e8be31e2e5c7197cc7706380",
    claimant: "agent:gp-001-demo",
    claimRecordHash: "sha256:c80e0c34b63c986109a804b6cd32e57fac80ecaa60f0733393e0a937c903be0c",
    taskFreezeHash: "sha256:95ca98eb0146c56be577f9704d8640bb99ef38b5271a94496fc8cc6aa61121e5",
  },
  /**
   * FIXTURE-ONLY program id for T1 golden vectors (TESTNET-R1.md §6/§12):
   * base58(sha256("intent-protocol/testnet-r1/fixture-program-id")).
   * It is a test vector input ONLY — NEVER the actual deployment program id,
   * which is pinned at T3 BEFORE deployment.
   */
  fixtureProgramId: "8d3sTN2WXf8SKcDR9iarBDScrupiG5TYVQcq8fuhK8aM",
} as const;

/**
 * Appendix A pinned slots — MATERIALIZED at T3 (Commander order TESTNET-R1/T3).
 * Source of record: materialization/appendix-a.json (committed); secrets live
 * outside the repository at ~/intent-testnet-r1-keys/ (0600) and are NEVER
 * committed (see materialization/CUSTODY.md).
 *
 * The program id was pinned BEFORE deployment by design (it is the program
 * keypair's pubkey); deployment itself is a T2-authorized bootstrap action
 * and has NOT happened. While the adapter package contains no RPC layer,
 * chain actions remain structurally unavailable.
 */
export const PINNED: Readonly<{
  programId: string | null; // actual deployment program id (pinned at T3, BEFORE deployment)
  mint: string | null; // frozen USDC-test mint pubkey
  deployer: string | null;
  operator: string | null;
  treasury: string | null;
  claimantWallet: string | null; // ClaimantPayoutBindingV1
  claimantTokenAccount: string | null; // ClaimantPayoutBindingV1 (ATA)
  claimantBindingHash: string | null; // ClaimantPayoutBindingV1.binding_hash (Appendix A)
}> = {
  programId: "ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F",
  mint: "CGLUuUdaeUkMk9GmKwM8EbQMtzRXrpsFsiLnoWwt1Fvh",
  deployer: "q9jYp8Jg2uNLrfxRhXs7VR275VYvGPbvYruvSoHpf6B",
  operator: "673H3SuS1o8cWEGFFpd4ua7roZppZWhKvAGBGgtsvTjN",
  treasury: "8QW7mvynD8xPwhW8mp584Yf6nmfwGWWqXtNDn194uvsv",
  claimantWallet: "6ce8Q7hxP5fbFPhKsUUpd7QHLGUYqfMHiNvZFkBAzwo8",
  claimantTokenAccount: "4R8BCsiLtAJn4xyWNMQhmbuvTYK3qm2jUgbqDofBBcQy",
  claimantBindingHash: "sha256:a22111250b2cfb399e5e03d8d80e84c1dc40bc365d711b3b1279a5215d75a092",
};

/** T0 §7 fund caps (frozen; test funds, production discipline). */
export const CAPS = {
  perRelease: "10", // USDC-test
  escrowTotalMax: "100", // test escrow total balance ceiling
  cycleCumulativeMax: "100", // max cumulative release per test cycle
} as const;

/** Roles derived from the pinned slots (distinctness asserted by tests). */
export const ROLES: Readonly<{ deployer: string; operator: string; treasury: string }> = {
  deployer: PINNED.deployer!,
  operator: PINNED.operator!,
  treasury: PINNED.treasury!,
};

/** Wrong-mint hard denial (T0 §7): only the frozen devnet mint is accepted. */
export class MintDeniedError extends Error {
  constructor(mint: string) {
    super(`mint denied (TESTNET-R1 T0 §7): ${mint} — frozen mint is ${PINNED.mint}`);
  }
}

export function assertFrozenMint(mint: string): void {
  if (mint !== PINNED.mint) throw new MintDeniedError(mint);
}

/** Role separation: ONLY the Operator may request settlements. */
export class RoleDeniedError extends Error {}

export function assertAuthorizedRequester(pubkey: string): void {
  if (pubkey === ROLES.operator) return;
  const who = pubkey === ROLES.deployer ? "deployer" : pubkey === ROLES.treasury ? "treasury" : "unknown";
  throw new RoleDeniedError(`unauthorized requester (${who}): only the Operator role may request settlements — ${pubkey}`);
}

/** Destination binding: the payout destination is resolved ONLY through the frozen binding. */
export class DestinationDeniedError extends Error {}

export function resolvePayoutDestination(claimant: string): string {
  if (claimant !== FROZEN.anchors.claimant) {
    throw new DestinationDeniedError(`unknown claimant: ${claimant}`);
  }
  if (PINNED.claimantWallet === null || PINNED.claimantTokenAccount === null || PINNED.claimantBindingHash === null) {
    throw new DestinationDeniedError("ClaimantPayoutBindingV1 not pinned");
  }
  return PINNED.claimantTokenAccount;
}

export function pinnedComplete(): boolean {
  return Object.values(PINNED).every((v) => v !== null);
}

/** T0 §7 hard denials — machine-tested, never README-only. */
const MAINNET_PATTERNS = [/mainnet-beta/i, /mainnet/i, /api\.mainnet/i, /production/i];

export class EndpointDeniedError extends Error {
  constructor(endpoint: string) {
    super(`MAINNET DENIED (TESTNET-R1 T0 §7): ${endpoint}`);
  }
}

export function assertNotMainnet(endpointOrCluster: string): void {
  if (MAINNET_PATTERNS.some((r) => r.test(endpointOrCluster))) {
    throw new EndpointDeniedError(endpointOrCluster);
  }
}
