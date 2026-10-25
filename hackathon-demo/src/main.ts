import { PublicKey } from "@solana/web3.js";
import {
  ERROR_TEXT,
  MAX_LAMPORTS,
  MIN_LAMPORTS,
  PROGRAM_ID,
  SAMPLE_ANSWER,
  SAMPLE_CRITERIA,
  STATUS_CANCELLED,
  STATUS_DELIVERED,
  STATUS_FUNDED,
  STATUS_SETTLED,
  STATUS_VERIFIED,
  hashUtf8,
  isZeroKey,
  statusLabel,
} from "@intent/hackathon-escrow";
import {
  assertDevnet,
  cancelInstructions,
  connection,
  createInstructions,
  explainUnknown,
  explorerAddress,
  explorerTx,
  intentPda,
  loadBoard,
  loadIntent,
  programIsDeployed,
  recentSignatures,
  sendInstructions,
  submitInstructions,
  verifyAndSettleInstructions,
} from "./chain";
import { availableWallets, provider, type InjectedWallet } from "./wallet";

type WalletId = "phantom" | "solflare";

const app = document.querySelector("#app");
if (!app) throw new Error("missing #app");

let wallet: InjectedWallet | null = null;
let walletName = "";
let balance = "";
let notice = "";
let noticeKind: "info" | "ok" | "warn" = "info";
let deployed: boolean | null = null;
let busy = false;

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

function route(): { name: "home" | "create" | "board" | "intent"; id?: string } {
  const hash = location.hash.replace(/^#/, "") || "/";
  if (hash.startsWith("/intent/")) return { name: "intent", id: decodeURIComponent(hash.slice("/intent/".length)) };
  if (hash === "/create") return { name: "create" };
  if (hash === "/board") return { name: "board" };
  return { name: "home" };
}

function pubkey(): PublicKey | null {
  const text = wallet?.publicKey?.toString();
  if (!text) return null;
  try {
    return new PublicKey(text);
  } catch {
    return null;
  }
}

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

function sol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function shell(body: string): string {
  const wallets = availableWallets();
  const connected = pubkey();
  const walletButtons = connected
    ? `<button class="btn" data-action="disconnect">Disconnect</button>`
    : wallets.map((item) => `<button class="btn btn-primary" data-action="connect" data-wallet="${item.id}">Connect ${esc(item.name)}</button>`).join("")
      || `<a class="btn" href="https://phantom.com/download" target="_blank" rel="noreferrer">Install Phantom</a>`;
  return `
    <header class="top">
      <div class="wrap top-row">
        <button class="brand" data-action="go" data-href="#/">INTENT</button>
        <nav>
          <a href="#/create">Create</a>
          <a href="#/board">Intents</a>
          <a href="/slides.html">Slides</a>
          ${walletButtons}
        </nav>
      </div>
      <div class="wrap" style="padding-bottom:12px">
        <div class="wallet-meta">
          Devnet · program <a href="${explorerAddress(PROGRAM_ID)}">${short(PROGRAM_ID)}</a>
          ${connected ? ` · ${esc(walletName)} ${short(connected.toBase58())}` : " · wallet not connected"}
          ${balance ? ` · ${esc(balance)} SOL` : ""}
          ${deployed === false ? " · program account not found" : ""}
        </div>
      </div>
    </header>
    <main><div class="wrap">${notice ? `<div class="banner ${noticeKind}">${esc(notice)}</div>` : ""}${body}</div></main>`;
}

function homeHtml(): string {
  return `
    <p class="kicker">Solana devnet · test SOL only</p>
    <h1>A safer way to pay for work.</h1>
    <p class="lede">Hire work without moving the goalposts. Freeze the rules before the work. Prove the outcome after. The sample locks 0.05 SOL. A wrong answer leaves it locked. The right answer pays once.</p>
    <div class="grid cards">
      <article class="card"><h2>1. Freeze the rule and the pay</h2><p class="muted">Write what “done” means, and lock the SOL in the same step. The rule cannot be edited after delivery.</p></article>
      <article class="card"><h2>2. Deliver against that rule</h2><p class="muted">Another wallet, or the same one, submits the work. The sample answer is 42. Try 41 first.</p></article>
      <article class="card"><h2>3. Get paid once, or not at all</h2><p class="muted">A match pays the locked SOL. A mismatch leaves it locked. Paying twice is rejected.</p></article>
    </div>
    <div class="row">
      <a class="btn btn-primary" href="#/create">Create an intent</a>
      <a class="btn" href="#/board">See on-chain intents</a>
    </div>
    <section class="panel" style="margin-top:28px">
      <p class="kicker">Onboarding</p>
      <ol class="steps">
        <li>Install <a href="https://phantom.com/download" target="_blank" rel="noreferrer">Phantom</a> or <a href="https://solflare.com/download" target="_blank" rel="noreferrer">Solflare</a>.</li>
        <li>In the wallet, switch the network to <strong>Devnet</strong>. Phantom: open the network menu at the top and choose Devnet. Solflare: use the network dropdown.</li>
        <li>Get test SOL. Use Airdrop on the create page, or <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a> if the airdrop is rate-limited.</li>
        <li>Use the sample intent. The done-criteria ask for the sum of 17 and 25. The sample answer is 42. Escrow is 0.05 SOL.</li>
      </ol>
      <p class="muted">This demo never asks for a secret key and never sends a mainnet transaction. The older immutable settlement program stays untouched.</p>
    </section>`;
}

function createHtml(): string {
  return `
    <p class="kicker">Create</p>
    <h1>Freeze a done-criteria.</h1>
    <p class="muted">The criteria text is stored on-chain. The expected submission is stored only as SHA-256. Range: 0.01 to 0.5 SOL.</p>
    <form id="create-form" class="panel">
      <label for="criteria">What does done mean?</label>
      <textarea id="criteria" name="criteria" maxlength="280" required>${esc(SAMPLE_CRITERIA)}</textarea>
      <label for="answer">Expected submission, hashed before it is sent</label>
      <input id="answer" name="answer" type="text" maxlength="128" required value="${esc(SAMPLE_ANSWER)}" />
      <label for="sol">Escrow (SOL)</label>
      <input id="sol" name="sol" type="number" min="0.01" max="0.5" step="0.01" value="0.05" required />
      <div class="row">
        <button class="btn btn-primary" type="submit" ${busy ? "disabled" : ""}>Freeze and escrow</button>
        <button class="btn" type="button" data-action="airdrop" ${busy ? "disabled" : ""}>Airdrop 1 devnet SOL</button>
        <button class="btn" type="button" data-action="sample">Reset sample</button>
      </div>
    </form>`;
}

function statusClass(status: number): string {
  if (status === STATUS_SETTLED || status === STATUS_VERIFIED) return "pill earned";
  if (status === STATUS_CANCELLED) return "pill warn";
  return "pill";
}

async function boardHtml(): Promise<string> {
  let rows: Awaited<ReturnType<typeof loadBoard>> = [];
  try {
    rows = await loadBoard();
  } catch (err) {
    return `<div class="banner warn">${esc(explainUnknown(err))}</div>`;
  }
  const items = rows.length
    ? rows.map((row) => `
        <a class="item" href="#/intent/${encodeURIComponent(row.address)}">
          <span class="${statusClass(row.account.status)}">${esc(statusLabel(row.account.status))}</span>
          <p>${esc(row.account.criteria)}</p>
          <p class="mono">${esc(row.address)} · ${esc(sol(row.account.amount))} SOL</p>
        </a>`).join("")
    : `<p class="muted">No intents yet. The first create also opens the on-chain registry.</p>`;
  return `<p class="kicker">On-chain registry</p><h1>Intents</h1><div class="intent-list">${items}</div>`;
}

async function intentHtml(id: string): Promise<string> {
  let loaded: Awaited<ReturnType<typeof loadIntent>>;
  try {
    loaded = await loadIntent(id);
  } catch (err) {
    return `<div class="banner warn">${esc(explainUnknown(err))}</div>`;
  }
  if (!loaded) return `<h1>Intent not found</h1><p class="muted">That account is not an intent on this program.</p>`;
  const { account } = loaded;
  const me = pubkey()?.toBase58() ?? "";
  const creator = new PublicKey(account.creator).toBase58();
  const deliverer = isZeroKey(account.deliverer) ? "" : new PublicKey(account.deliverer).toBase58();
  let signatures: string[] = [];
  try {
    signatures = await recentSignatures(id);
  } catch {
    signatures = [];
  }
  const links = signatures.map((sig) => `<li><a href="${explorerTx(sig)}">${esc(short(sig))}</a></li>`).join("");
  const canSubmit = account.status === STATUS_FUNDED || account.status === STATUS_DELIVERED;
  const canSettle = account.status === STATUS_DELIVERED;
  const canCancel = me === creator && (account.status === STATUS_FUNDED || account.status === STATUS_DELIVERED);
  return `
    <p class="kicker">Intent</p>
    <h1>${esc(account.criteria)}</h1>
    <p><span class="${statusClass(account.status)}">${esc(statusLabel(account.status))}</span></p>
    <div class="grid cards">
      <article class="card"><h2>Escrow</h2><p>${esc(sol(account.amount))} SOL</p><p class="mono"><a href="${explorerAddress(id)}">Intent account</a></p></article>
      <article class="card"><h2>Creator</h2><p class="mono">${esc(creator)}</p></article>
      <article class="card"><h2>Deliverer</h2><p class="mono">${deliverer ? esc(deliverer) : "Waiting for a submission"}</p></article>
    </div>
    ${account.submission ? `<section class="panel"><p class="kicker">Submission</p><p>${esc(account.submission)}</p></section>` : ""}
    ${account.status === STATUS_SETTLED ? `<div class="banner ok">Settled once. The vault paid the deliverer. A second settle is rejected on-chain (${esc(ERROR_TEXT[208] ?? "")}).</div>` : ""}
    ${canSubmit ? `
      <form id="submit-form" class="panel">
        <p class="kicker">Deliver</p>
        <label for="submission">Submission</label>
        <input id="submission" name="submission" type="text" maxlength="128" required placeholder="For the sample, submit 42" />
        <div class="row"><button class="btn btn-primary" type="submit" ${busy ? "disabled" : ""}>Submit delivery</button></div>
        <p class="muted">Use a second wallet if you want the two roles split. The same wallet is allowed: the program still does the check.</p>
      </form>` : ""}
    <div class="row">
      ${canSettle ? `<button class="btn btn-primary" data-action="settle" data-intent="${esc(id)}" data-deliverer="${esc(deliverer)}" ${busy ? "disabled" : ""}>Verify and settle</button>` : ""}
      ${canCancel ? `<button class="btn" data-action="cancel" data-intent="${esc(id)}" ${busy ? "disabled" : ""}>Cancel and return escrow</button>` : ""}
    </div>
    <section class="panel" style="margin-top:18px">
      <p class="kicker">Explorer</p>
      ${links ? `<ul>${links}</ul>` : `<p class="muted">No transactions indexed for this account yet.</p>`}
    </section>`;
}

async function render(): Promise<void> {
  const current = route();
  let body = "";
  if (current.name === "home") body = homeHtml();
  else if (current.name === "create") body = createHtml();
  else if (current.name === "board") body = await boardHtml();
  else body = await intentHtml(current.id ?? "");
  app!.innerHTML = shell(body);
}

function setNotice(kind: "info" | "ok" | "warn", text: string): void {
  noticeKind = kind;
  notice = text;
}

async function refreshBalance(): Promise<void> {
  const owner = pubkey();
  if (!owner) {
    balance = "";
    return;
  }
  const lamports = await connection.getBalance(owner);
  balance = sol(BigInt(lamports));
}

async function connect(id: WalletId): Promise<void> {
  const injected = provider(id);
  if (!injected) {
    setNotice("warn", "That wallet extension is not available in this browser.");
    await render();
    return;
  }
  await injected.connect();
  wallet = injected;
  walletName = id === "phantom" ? "Phantom" : "Solflare";
  injected.on?.("disconnect", () => {
    wallet = null;
    balance = "";
    void render();
  });
  await assertDevnet();
  await refreshBalance();
  setNotice("ok", "Wallet connected. Confirm the wallet network is Devnet before you sign.");
  await render();
}

async function withBusy(work: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  await render();
  try {
    await work();
  } catch (err) {
    setNotice("warn", explainUnknown(err));
  } finally {
    busy = false;
    await refreshBalance().catch(() => undefined);
    await render();
  }
}

async function onCreate(form: HTMLFormElement): Promise<void> {
  const owner = pubkey();
  if (!owner) {
    setNotice("warn", "Connect a devnet wallet first.");
    await render();
    return;
  }
  const data = new FormData(form);
  const criteria = String(data.get("criteria") ?? "").trim();
  const answer = String(data.get("answer") ?? "");
  const solAmount = Number(data.get("sol"));
  if (!Number.isFinite(solAmount)) throw new Error("Enter an escrow amount.");
  const lamports = BigInt(Math.round(solAmount * 1_000_000_000));
  if (lamports < MIN_LAMPORTS || lamports > MAX_LAMPORTS) {
    throw new Error("The escrow amount must be between 0.01 and 0.5 SOL.");
  }
  const nonce = BigInt(Date.now());
  const intent = intentPda(owner, nonce).toBase58();
  await withBusy(async () => {
    const signature = await sendInstructions(
      owner,
      createInstructions({
        creator: owner,
        nonce,
        lamports,
        expectedHash: hashUtf8(answer),
        criteria,
      }),
      (tx) => wallet!.signTransaction(tx),
    );
    setNotice("ok", `Frozen and escrowed. ${signature}`);
    location.hash = `#/intent/${encodeURIComponent(intent)}`;
  });
}

document.body.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("[data-action]");
  if (!(button instanceof HTMLElement)) return;
  const action = button.dataset.action;
  if (action === "go") location.hash = button.dataset.href ?? "#/";
  if (action === "connect") void connect((button.dataset.wallet as WalletId) ?? "phantom").catch((err) => {
    setNotice("warn", explainUnknown(err));
    void render();
  });
  if (action === "disconnect") {
    void wallet?.disconnect();
    wallet = null;
    balance = "";
    void render();
  }
  if (action === "sample") {
    const criteria = document.querySelector<HTMLTextAreaElement>("#criteria");
    const answer = document.querySelector<HTMLInputElement>("#answer");
    const amount = document.querySelector<HTMLInputElement>("#sol");
    if (criteria) criteria.value = SAMPLE_CRITERIA;
    if (answer) answer.value = SAMPLE_ANSWER;
    if (amount) amount.value = "0.05";
  }
  if (action === "airdrop") {
    const owner = pubkey();
    if (!owner) {
      setNotice("warn", "Connect a wallet before requesting an airdrop.");
      void render();
      return;
    }
    void withBusy(async () => {
      const signature = await connection.requestAirdrop(owner, 1_000_000_000);
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction({ signature, ...latest }, "confirmed");
      setNotice("ok", "Airdrop confirmed. If this fails next time, use faucet.solana.com.");
    });
  }
  if (action === "settle") {
    const owner = pubkey();
    const intent = button.dataset.intent ?? "";
    const deliverer = button.dataset.deliverer ?? "";
    if (!owner || !intent || !deliverer) return;
    void withBusy(async () => {
      const signature = await sendInstructions(
        owner,
        verifyAndSettleInstructions(new PublicKey(intent), new PublicKey(deliverer)),
        (tx) => wallet!.signTransaction(tx),
      );
      setNotice("ok", `Verified and settled once. ${explorerTx(signature)}`);
    });
  }
  if (action === "cancel") {
    const owner = pubkey();
    const intent = button.dataset.intent ?? "";
    if (!owner || !intent) return;
    void withBusy(async () => {
      const signature = await sendInstructions(
        owner,
        cancelInstructions(owner, new PublicKey(intent)),
        (tx) => wallet!.signTransaction(tx),
      );
      setNotice("ok", `Escrow returned. ${explorerTx(signature)}`);
    });
  }
});

document.body.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === "create-form") void onCreate(form);
  if (form.id === "submit-form") {
    const owner = pubkey();
    const id = route().id;
    const submission = String(new FormData(form).get("submission") ?? "");
    if (!owner || !id) {
      setNotice("warn", "Connect a wallet on the intent page before submitting.");
      void render();
      return;
    }
    void withBusy(async () => {
      const signature = await sendInstructions(
        owner,
        submitInstructions(owner, new PublicKey(id), submission),
        (tx) => wallet!.signTransaction(tx),
      );
      setNotice("ok", `Delivery recorded. ${explorerTx(signature)}`);
    });
  }
});

window.addEventListener("hashchange", () => {
  notice = "";
  void render();
});

void (async () => {
  try {
    await assertDevnet();
    deployed = await programIsDeployed();
    if (!deployed) setNotice("warn", "The devnet program account was not found. Creation will fail until it is deployed.");
  } catch (err) {
    setNotice("warn", explainUnknown(err));
  }
  await render();
})();
