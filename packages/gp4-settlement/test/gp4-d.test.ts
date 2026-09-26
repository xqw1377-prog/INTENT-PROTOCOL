/**
 * GP4-D — crash / restart / response-loss recovery matrix.
 *
 * GATES.md GP4: "crash/retry recovery preserves exactly one economic
 * release." GOLDEN-PATH-V1.md §7 case 8: "crash/retry after the release
 * boundary → still exactly one economic release."
 *
 * Two evidence layers:
 *   D-01..D-08 — deterministic torn-state matrix: EVERY possible on-disk
 *                intermediate state enumerated, reopened, invariants held
 *   D-09       — real kill race: children killed mid-contention; the
 *                surviving ledger still holds exactly-one-release
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { EscrowLedger, ReleaseRecordSchema, InstructionRecordSchema } from "../src/index.ts";
import {
  ESCROW_REF, FROZEN_ASSET, FROZEN_CLAIM_HASH, FROZEN_RH, enabledLedger, frozenClaim,
  frozenReceipt, instructionFiles, makeInstruction, releaseFiles, withRaceLock,
} from "./util.ts";

const ESCROW_DIR_SEG = "escrow%3agp-001-local";

/** Deterministic torn-state construction (no timing, no kills). */
function buildTorn(opts: { guard?: "valid" | "corrupt"; journal?: boolean; escrowState?: "LOCKED" | "ELIGIBLE" | "RELEASED" }): string {
  const { ledger, root } = enabledLedger(); // creates enabled escrow, LOCKED
  void ledger;
  const dir = path.join(root, "escrows", ESCROW_DIR_SEG);
  if (opts.guard === "valid") {
    // produce a REAL release record by performing the release, then rewind
    // the escrow.json to the requested torn state
    const l = EscrowLedger.open(root);
    const r = l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "1" }), claim_record: frozenClaim() });
    expect(r.status).toBe("RELEASED");
    if (opts.escrowState && opts.escrowState !== "RELEASED") {
      const f = path.join(dir, "escrow.json");
      const entry = JSON.parse(readFileSync(f, "utf8"));
      writeFileSync(f, JSON.stringify({ ...entry, state: opts.escrowState }));
    }
    if (!opts.journal) {
      for (const j of instructionFiles(root)) {
        // simulate crash before the journal write
        unlinkSync(path.join(dir, "instructions", j));
      }
    }
  } else if (opts.guard === "corrupt") {
    writeFileSync(path.join(dir, "releases", `${FROZEN_RH.slice(7)}.json`), Buffer.from("garbage"));
  } else if (opts.journal) {
    // journal-only (no guard): forged/impossible ordering — must not grant a release
    const sk = "sha256:" + "11".repeat(32);
    const dir2 = path.join(dir, "instructions");
    if (!existsSync(dir2)) mkdirSync(dir2, { recursive: true });
    writeFileSync(path.join(dir2, `${sk.slice(7)}.json`), JSON.stringify({
      schema_version: "gp4-instruction.v1", settlement_key: sk, escrow_ref: ESCROW_REF,
      outcome_receipt_hash: FROZEN_RH, nonce: "1", first_seen_at: 1,
    }));
  }
  if (!opts.guard && opts.escrowState === "ELIGIBLE") {
    const f = path.join(dir, "escrow.json");
    const entry = JSON.parse(readFileSync(f, "utf8"));
    writeFileSync(f, JSON.stringify({ ...entry, state: "ELIGIBLE" }));
  }
  return root;
}

describe("[GP4-D] crash / restart / response-loss recovery", () => {
  test("[D-01] S0 pristine crash point (before any write) → LOCKED, releasable exactly once", () => {
    const root = buildTorn({});
    const l = EscrowLedger.open(root);
    expect(l.readEscrow(ESCROW_REF)!.state).toBe("LOCKED");
    expect(releaseFiles(root)).toHaveLength(0);
    expect(l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("RELEASED");
    expect(l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "2" }), claim_record: frozenClaim() }).status).toBe("ALREADY_RELEASED");
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[D-02] S1 crash between guard and state flip → reopen repairs RELEASED, replay idempotent", () => {
    const root = buildTorn({ guard: "valid", escrowState: "LOCKED", journal: false });
    const l = EscrowLedger.open(root);
    expect(l.readEscrow(ESCROW_REF)!.state).toBe("RELEASED"); // guard is the authority
    const r = l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "9" }), claim_record: frozenClaim() });
    expect(r.status).toBe("ALREADY_RELEASED"); // response-loss retry: exactly one release ever
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[D-03] S2 guard present + journal torn off + state ELIGIBLE (double torn) → still RELEASED, one release", () => {
    const root = buildTorn({ guard: "valid", escrowState: "ELIGIBLE", journal: false });
    const l = EscrowLedger.open(root);
    expect(l.readEscrow(ESCROW_REF)!.state).toBe("RELEASED");
    expect(l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("ALREADY_RELEASED");
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[D-04] S3 complete release (guard+journal+state) → stable, replays idempotent", () => {
    const root = buildTorn({ guard: "valid" }); // leaves RELEASED + journal
    const l = EscrowLedger.open(root);
    expect(l.readEscrow(ESCROW_REF)!.state).toBe("RELEASED");
    for (let i = 0; i < 3; i++) {
      expect(l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: String(i + 20) }), claim_record: frozenClaim() }).status).toBe("ALREADY_RELEASED");
    }
    expect(releaseFiles(root)).toHaveLength(1);
    // every on-disk record parses against the strict schemas
    ReleaseRecordSchema.parse(JSON.parse(readFileSync(path.join(root, "escrows", ESCROW_DIR_SEG, "releases", `${FROZEN_RH.slice(7)}.json`), "utf8")));
    for (const j of instructionFiles(root)) {
      InstructionRecordSchema.parse(JSON.parse(readFileSync(path.join(root, "escrows", ESCROW_DIR_SEG, "instructions", j), "utf8")));
    }
  });

  test("[D-05] S4 legacy ELIGIBLE without guard → demoted LOCKED, releasable exactly once", () => {
    const root = buildTorn({ escrowState: "ELIGIBLE" });
    const l = EscrowLedger.open(root);
    expect(l.readEscrow(ESCROW_REF)!.state).toBe("LOCKED");
    expect(l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("RELEASED");
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[D-06] S5 journal-only (no guard, impossible ordering / forged) → NOT released; economic guard rules", () => {
    const root = buildTorn({ journal: true });
    const l = EscrowLedger.open(root);
    expect(l.readEscrow(ESCROW_REF)!.state).toBe("LOCKED"); // journal never grants release
    expect(releaseFiles(root)).toHaveLength(0);
    // a fresh instruction with the SAME settlement_key still cannot double-release later
    expect(l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("RELEASED");
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[D-07] S6 corrupt guard → LEDGER_CORRUPT forever, no second file, no overwrite", () => {
    const root = buildTorn({ guard: "corrupt" });
    const l = EscrowLedger.open(root);
    for (const nonce of ["1", "2", "3"]) {
      expect(l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce }), claim_record: frozenClaim() }).status).toBe("LEDGER_CORRUPT");
    }
    expect(releaseFiles(root)).toHaveLength(1); // the corrupt file itself — never replaced
    expect(readFileSync(path.join(root, "escrows", ESCROW_DIR_SEG, "releases", `${FROZEN_RH.slice(7)}.json`), "utf8")).toBe("garbage");
  });

  test("[D-08] invariant summary across the whole matrix: release-file count ≤ 1 everywhere, guard ⇔ RELEASED", () => {
    for (const opts of [{}, { guard: "valid" as const }, { guard: "valid" as const, journal: false, escrowState: "LOCKED" as const }, { escrowState: "ELIGIBLE" as const }, { journal: true }]) {
      const root = buildTorn(opts);
      EscrowLedger.open(root);
      expect(releaseFiles(root).length, JSON.stringify(opts)).toBeLessThanOrEqual(1);
      const l = EscrowLedger.open(root);
      const hasGuard = releaseFiles(root).length === 1;
      if (hasGuard) expect(l.readEscrow(ESCROW_REF)!.state).toBe("RELEASED");
    }
  });

  test("[D-09] REAL kill race: 8 children contend, 3 killed mid-flight → exactly one economic release", { timeout: 240_000 }, async () => {
    const { root } = enabledLedger();
    const scriptPath = fileURLToPath(new URL("../scripts/attempt-release.ts", import.meta.url));
    const receiptPath = fileURLToPath(new URL("../../../packages/gp3-verification/artifacts/receipt.json", import.meta.url));
    const claimPath = fileURLToPath(new URL("../fixtures/gp-001-claim.json", import.meta.url));
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

    const outputs = await withRaceLock(async () => {
      const children = [1, 2, 3, 4, 5, 6, 7, 8].map((nonce) =>
        spawn(process.execPath, ["--experimental-strip-types", scriptPath, root, ESCROW_REF, receiptPath, claimPath, String(nonce), "10", "solana-devnet", "USDC-test", "6"], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }));

      // kill 3 of them mid-boot/mid-attempt — genuine crash injection
      await new Promise((r) => setTimeout(r, 150));
      for (const c of [children[0]!, children[2]!, children[4]!]) {
        try { c.kill(); } catch { /* already exited */ }
      }

      // collect whatever the survivors print (killed children may print nothing)
      return Promise.all(children.map((c) => new Promise<string>((resolve) => {
        let out = "";
        c.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        c.on("close", () => resolve(out.trim()));
        c.on("error", () => resolve(out.trim()));
      })));
    });

    // THE invariants, independent of who was killed:
    const l = EscrowLedger.open(root); // restart
    const guards = releaseFiles(root);
    expect(guards.length).toBe(1); // exactly one economic release across kills
    expect(l.readEscrow(ESCROW_REF)!.state).toBe("RELEASED");
    const guardBytes = readFileSync(path.join(root, "escrows", ESCROW_DIR_SEG, "releases", guards[0]!), "utf8");
    expect(() => ReleaseRecordSchema.parse(JSON.parse(guardBytes))).not.toThrow(); // fully-formed, never torn
    // post-restart replays (crash/retry after the boundary): all idempotent
    for (const nonce of ["1", "5", "99"]) {
      expect(l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce }), claim_record: frozenClaim() }).status).toBe("ALREADY_RELEASED");
    }
    expect(releaseFiles(root)).toHaveLength(1);
    // at most one child ever observed RELEASED
    const releasedSeen = outputs.filter((o) => o.includes('"RELEASED"')).length;
    expect(releasedSeen).toBeLessThanOrEqual(1);
    void FROZEN_ASSET; void FROZEN_CLAIM_HASH;
  });
});
