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
 * Appendix A pinned slots. EVERY slot is null until the T3 devnet
 * materialization freeze. While any slot is null the adapter has NO real
 * transaction capability — structurally, not just by policy.
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
  programId: null,
  mint: null,
  deployer: null,
  operator: null,
  treasury: null,
  claimantWallet: null,
  claimantTokenAccount: null,
  claimantBindingHash: null,
};

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
