export interface InjectedWallet {
  name: string;
  publicKey: { toString(): string; toBytes(): Uint8Array } | null;
  connect(): Promise<{ publicKey: { toString(): string; toBytes(): Uint8Array } }>;
  disconnect(): Promise<void>;
  signTransaction<T>(tx: T): Promise<T>;
  on?(event: string, cb: () => void): void;
}

interface WindowWithWallets extends Window {
  solana?: InjectedWallet & { isPhantom?: boolean };
  solflare?: InjectedWallet & { isSolflare?: boolean };
}

function win(): WindowWithWallets {
  return window as WindowWithWallets;
}

export function availableWallets(): Array<{ id: "phantom" | "solflare"; name: string }> {
  const list: Array<{ id: "phantom" | "solflare"; name: string }> = [];
  if (win().solana?.isPhantom) list.push({ id: "phantom", name: "Phantom" });
  if (win().solflare) list.push({ id: "solflare", name: "Solflare" });
  return list;
}

export function provider(id: "phantom" | "solflare"): InjectedWallet | null {
  if (id === "phantom") return win().solana?.isPhantom ? win().solana ?? null : null;
  return win().solflare ?? null;
}
