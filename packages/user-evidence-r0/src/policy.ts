/**
 * USER-EVIDENCE-R0 / UE-2 (CUT-2) — pre-execution patch policy (pure).
 *
 * The runner evaluates a worker patch against the frozen ruleset BEFORE any
 * code executes: forbidden path, out-of-scope path, diff bound, binary
 * patch, or any dependency-section change disqualifies the run with ZERO
 * commands executed. The wall is pre-execution, never post-hoc.
 *
 * Normative grammar (frozen in the UE-2 contract, §7):
 *   patch format  = unified diff (git diff form), TEXT files only
 *   touched path  = union of a-side and b-side paths of every file entry,
 *                   plus rename from/to targets; /dev/null sides ignored
 *   diff lines    = total '+' lines plus '-' lines, excluding +++ / ---
 *   glob          = '**' crosses '/', '*' does not; everything else literal;
 *                   a path is in scope iff it matches at least one allowed
 *                   glob and no forbidden glob (forbidden wins)
 *   dependency policy = dependency sections of any touched package.json
 *                   (dependencies, devDependencies, peerDependencies,
 *                   optionalDependencies, bundledDependencies, overrides,
 *                   resolutions) must be identical before/after; a newly
 *                   created package.json must carry all-empty sections;
 *                   deleting one counts as changing every dependency.
 *
 * The portable verifier (src/portable-replay.mjs) re-implements this module
 * INDEPENDENTLY and must not import it: verifier independence over sharing.
 */

export interface ParsedPatch {
  touchedPaths: string[];
  addedLines: number;
  removedLines: number;
  binary: boolean;
}

/** Split the two path tokens of a `diff --git a/x b/y` header, honoring quotes. */
function splitGitPaths(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length && out.length < 2) {
    while (i < s.length && s[i] === " ") i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      const j = s.indexOf('"', i + 1);
      if (j === -1) { out.push(s.slice(i)); break; }
      out.push(s.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = s.indexOf(" ", i);
      if (j === -1) j = s.length;
      out.push(s.slice(i, j));
      i = j;
    }
  }
  return out;
}

/** Undo git's C-style quoting of unusual pathnames. */
function unquote(p: string): string {
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    try {
      return JSON.parse(p) as string;
    } catch {
      return p.slice(1, -1);
    }
  }
  return p;
}

/** Normalize one side of a diff header to a repo-relative POSIX path; "" for /dev/null. */
function stripSide(p: string): string {
  const t = unquote(p.trim());
  if (t === "/dev/null" || t === "") return "";
  if (t.startsWith("a/") || t.startsWith("b/")) return t.slice(2);
  return t;
}

export function parseUnifiedPatch(raw: string | Buffer): ParsedPatch {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const touched = new Set<string>();
  let added = 0;
  let removed = 0;
  let binary = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("GIT binary patch")) binary = true;
    if (line.startsWith("diff --git ")) {
      for (const side of splitGitPaths(line.slice("diff --git ".length))) {
        const p = stripSide(side);
        if (p) touched.add(p);
      }
    } else if (line.startsWith("rename from ")) {
      const p = unquote(line.slice("rename from ".length).trim());
      if (p) touched.add(p);
    } else if (line.startsWith("rename to ")) {
      const p = unquote(line.slice("rename to ".length).trim());
      if (p) touched.add(p);
    } else if (line.startsWith("+++ ")) {
      const p = stripSide(line.slice(4));
      if (p) touched.add(p);
    } else if (line.startsWith("--- ")) {
      const p = stripSide(line.slice(4));
      if (p) touched.add(p);
    }
    if (/^\+(?!\+\+\+)/.test(line)) added++;
    else if (/^-(?!---)/.test(line)) removed++;
  }
  return { touchedPaths: [...touched].sort(), addedLines: added, removedLines: removed, binary };
}

/** Frozen glob grammar: "**" crosses "/", "*" does not; "x/**" covers every path under x/. */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += "[\\s\\S]*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export type ScopeDecision = { scope: "allowed" } | { scope: "forbidden" } | { scope: "out-of-scope" };

export function pathScope(p: string, allowed: readonly string[], forbidden: readonly string[]): ScopeDecision {
  if (forbidden.some((g) => globToRegExp(g).test(p))) return { scope: "forbidden" };
  if (allowed.some((g) => globToRegExp(g).test(p))) return { scope: "allowed" };
  return { scope: "out-of-scope" };
}

export interface PatchRuleset {
  allowed_paths: readonly string[];
  forbidden_paths: readonly string[];
  max_diff_lines: number;
}

export interface PolicyDecision {
  ok: boolean;
  /** first violation, e.g. "forbidden-path:test/green.test.ts" / "diff-over-bound:37>10" */
  reason?: string;
}

export function evaluatePatchPolicy(patch: ParsedPatch, rules: PatchRuleset): PolicyDecision {
  if (patch.binary) return { ok: false, reason: "binary-patch" };
  if (patch.touchedPaths.length === 0) return { ok: false, reason: "empty-patch" };
  for (const p of patch.touchedPaths) {
    const d = pathScope(p, rules.allowed_paths, rules.forbidden_paths);
    if (d.scope === "forbidden") return { ok: false, reason: `forbidden-path:${p}` };
    if (d.scope === "out-of-scope") return { ok: false, reason: `out-of-scope:${p}` };
  }
  const total = patch.addedLines + patch.removedLines;
  if (total > rules.max_diff_lines) return { ok: false, reason: `diff-over-bound:${total}>${rules.max_diff_lines}` };
  return { ok: true };
}

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "overrides",
  "resolutions",
] as const;

/** Extract the dependency-relevant sections; null if the text is not a JSON object. */
export function dependencySectionsOf(pkgJsonText: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(pkgJsonText);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const src = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const s of DEP_SECTIONS) out[s] = src[s] ?? {};
  return out;
}

/** beforeText null = the package.json did not exist before the patch. */
export function dependencySectionsUnchanged(beforeText: string | null, afterText: string | null): boolean {
  if (beforeText === null) {
    if (afterText === null) return true;
    const after = dependencySectionsOf(afterText);
    if (after === null) return false;
    return Object.values(after).every(
      (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0,
    );
  }
  if (afterText === null) return false; // deleting the manifest removes every dependency
  const before = dependencySectionsOf(beforeText);
  const after = dependencySectionsOf(afterText);
  if (before === null || after === null) return false;
  return JSON.stringify(before) === JSON.stringify(after);
}

/** True for any path the dependency policy must inspect. */
export function isDependencyManifestPath(p: string): boolean {
  return p === "package.json" || p.endsWith("/package.json");
}
