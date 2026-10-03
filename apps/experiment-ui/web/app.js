/* FRONTEND-R1 / FR-1 + FR-2 — Facilitated Experiment UI (vanilla, no deps).
   Every displayed state comes from /api/state, which derives it from the
   experiment artifacts. This script never computes verdicts, hashes, or
   entitlements — it renders them. */

const $ = (sel) => document.querySelector(sel);
let STATE = null;

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mono = (s) => `<span class="mono">${esc(s)}</span>`;

/* ── header facts strip (spec §2: facts never merge into one status) ── */
const FACT_LABELS = [
  ["rules_state", "RULES"],
  ["tier1_entitlement", "TIER 1"],
  ["replay", "REPLAY"],
  ["payer_response", "PAYER"],
];
const FACT_CLASS = { FROZEN: "frozen", EARNED: "frozen", PASS: "frozen", VALID: "frozen", NOT_EARNED: "invalid", FAIL: "invalid", INVALID: "invalid", PENDING: "pending", DRAFT: "pending", NONE: "pending", OPEN: "pending", RECORDED: "frozen" };

function renderHeader(state) {
  const dot = $("#phase-dot");
  dot.className = "phase-dot " + ({ FROZEN: "frozen", READY_TO_FREEZE: "ready", AWAITING_PAYER: "awaiting", CHECKING: "checking" }[state.phase] || "pending");
  $("#phase-name").textContent = state.phase.replace(/_/g, " ");
  $("#facts-strip").innerHTML = FACT_LABELS.map(
    ([key, label]) => {
      const v = state.facts[key];
      return `<span class="fact"><span class="k">${label}</span><span class="v ${FACT_CLASS[v] || ""}">${esc(v)}</span></span>`;
    },
  ).join("");
}

/* ── shared renderers ── */
function factCard(title, value, opts = {}) {
  return `<div class="card ${opts.frozen ? "frozen-card" : ""}">
    <div class="card-title">${esc(title)}</div>
    <div class="card-value ${opts.frozen ? "frozen" : ""}">${esc(value)}</div>
    ${opts.sub ? `<div class="sub-line">${mono(opts.sub)}</div>` : ""}
  </div>`;
}

function technicalDetails(entries) {
  if (!entries.length) return "";
  return `<details class="tech"><summary>View technical details</summary><div class="body">${entries
    .map(([k, v]) => `${esc(k).padEnd(24, " ")} ${esc(v)}`)
    .join("\n")}</div></details>`;
}

/* ── F1 · phase DRAFT: Prepare the task ── */
function renderPrepare(state) {
  const d = state.draft || {};
  const n = state.notes || {};
  const eligibility = state.eligibility;
  const field = (id, label, value, opts = {}) =>
    `<div class="form-field ${opts.full ? "full" : ""}">
      <label for="f-${id}">${esc(label)}</label>
      <input id="f-${id}" data-field="${id}" value="${esc(value ?? "")}" placeholder="${esc(opts.ph || "")}" ${opts.disabled ? "disabled" : ""} />
      ${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ""}
    </div>`;

  const form = `
    <form id="prepare-form">
      <h2 class="section-title">Who</h2>
      <div class="form-grid">
        ${field("payer_identity", "Payer (maintainer)", d.payer_identity, { ph: "e.g. alice — repo maintainer" })}
        ${field("worker_identity", "Assigned worker", d.worker_identity, { ph: "e.g. bob — external contributor" })}
      </div>
      <p class="note">Claim mode: <strong>Single claimant</strong> — this experiment is frozen for this worker only. It is not an open bounty.</p>

      <h2 class="section-title">Context</h2>
      <div class="form-grid">
        ${field("repoPath", "Repository (local path for the experiment)", d.repoPath, { full: true, ph: "/absolute/path/to/repo" })}
        ${field("base_commit_sha", "Base commit (40-hex SHA)", d.base_commit_sha, { ph: "full git commit SHA" })}
        ${field("tier1_reward", "Tier-1 reward", d.tier1_reward || "", { ph: "e.g. 10 (testnet / symbolic)" })}
        ${field("tier2_reward", "Tier-2 reward (not evaluated in this experiment)", d.tier2_reward || "0")}
        <div class="form-field full">
          <label for="f-issue_url">Issue <span class="badge unfrozen">Unfrozen context</span></label>
          <input id="f-issue_url" data-field="issue_url" value="${esc(n.issue_url || "")}" placeholder="#412 · link or reference" />
          <span class="hint">Helpful context only. It does not determine whether Tier 1 is earned.</span>
        </div>
        <div class="form-field full">
          <label for="f-summary">Summary <span class="badge unfrozen">Unfrozen context</span></label>
          <textarea id="f-summary" data-field="summary">${esc(n.summary || "")}</textarea>
        </div>
      </div>

      <h2 class="section-title">What must be true</h2>
      <div class="form-grid">
        ${field("regression_command", "Regression command (must FAIL on base)", d.regression_command, { full: true, ph: "the command that reproduces the bug (red on the frozen base)" })}
        ${field("baseline_health_command", "Baseline health command (must PASS on base)", d.baseline_health_command, { full: true })}
        ${field("patched_acceptance_command", "Patched acceptance command (run after the patch)", d.patched_acceptance_command, { full: true })}
        ${field("allowed_paths", "Allowed paths (comma-separated globs)", (d.allowed_paths || []).join(", "), { ph: "src/**" })}
        ${field("forbidden_paths", "Protected paths (comma-separated globs)", (d.forbidden_paths || []).join(", "), { ph: "test/**, package-lock.json, .github/**" })}
        ${field("max_diff_lines", "Maximum patch size (changed lines)", d.max_diff_lines ?? 40)}
        ${field("determinism_runs", "Repeat verification (consecutive passes)", d.determinism_runs ?? 3)}
        <div class="form-field full">
          <label>Install command</label>
          <input value="npm ci --ignore-scripts" disabled />
          <span class="hint">Fixed for this experiment: dependency materialization only, no scripts, no shell.</span>
        </div>
        <div class="form-field full">
          <label>Network access</label>
          <input value="Disabled during verification" disabled />
        </div>
      </div>
      <div class="actions">
        <button class="primary" type="submit">Save configuration</button>
        <span class="note">Nothing is frozen yet — configuration can still change freely.</span>
      </div>
    </form>`;

  const eligibilityBlock = eligibility
    ? eligibility.ok
      ? `<div class="card frozen-card"><div class="card-title">Eligibility</div><div class="card-value frozen">ELIGIBLE FOR FREEZE</div></div>`
      : `<div class="card" style="border-color:var(--invalid)"><div class="card-title">Eligibility</div><div class="error-note">NOT ELIGIBLE — ${esc(eligibility.reason)}</div></div>`
    : "";

  $("#main").innerHTML = `
    <h1 class="page-title">Prepare the task</h1>
    <p class="page-subtitle">Define what must be true before anyone starts working.</p>
    ${form}
    <hr class="divider-strong" />
    <h2 class="section-title">Check eligibility</h2>
    <p class="note">Runs the real preflight in a network-denied sandbox: base materialization, dependency reconstruction, the regression going red, the baseline staying green. No pre-commit is requested at this stage.</p>
    ${eligibilityBlock}
    <div class="actions">
      <button class="secondary" id="btn-check" ${state.hasDraft ? "" : "disabled"}>Check eligibility</button>
      ${state.hasDraft && eligibility?.ok ? `<button class="primary" id="btn-to-review">Review before freeze →</button>` : ""}
    </div>`;

  $("#prepare-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const get = (id) => document.querySelector(`[data-field="${id}"]`).value;
    const payload = {
      repoPath: get("repoPath").trim(),
      base_commit_sha: get("base_commit_sha").trim(),
      payer_identity: get("payer_identity").trim(),
      worker_identity: get("worker_identity").trim(),
      tier1_reward: get("tier1_reward").trim(),
      tier2_reward: get("tier2_reward").trim() || "0",
      allowed_paths: get("allowed_paths").split(",").map((s) => s.trim()).filter(Boolean),
      forbidden_paths: get("forbidden_paths").split(",").map((s) => s.trim()).filter(Boolean),
      max_diff_lines: Number(get("max_diff_lines")) || 40,
      determinism_runs: Number(get("determinism_runs")) || 3,
      regression_command: get("regression_command").trim(),
      baseline_health_command: get("baseline_health_command").trim(),
      patched_acceptance_command: get("patched_acceptance_command").trim(),
      notes: { issue_url: get("issue_url").trim(), summary: get("summary").trim(), payer_quote: "" },
    };
    try {
      await api("/api/prepare", payload);
      await refresh();
    } catch (e) {
      alert(e.message);
    }
  });
  $("#btn-check")?.addEventListener("click", async () => {
    setBusy("Checking eligibility — this runs the real preflight and can take a few minutes…");
    try {
      const r = await api("/api/check-eligibility");
      await refresh();
      if (!r.ok) console.warn("not eligible:", r.reason);
    } catch (e) {
      await refresh();
      alert(e.message);
    }
  });
  $("#btn-to-review")?.addEventListener("click", () => renderReadyToFreeze(STATE));
}

/* ── F1 · phase READY_TO_FREEZE: the payer review + pre-commit moment ── */
function renderReadyToFreeze(state) {
  const d = state.draft;
  const n = state.notes || {};
  const e = state.eligibility;
  const proven = [
    ["Regression is red on the frozen base", e.proven.base_regression === "RED" ? "proven at preflight" : ""],
    ["Existing baseline is green", e.proven.baseline_health === "GREEN" ? "proven at preflight" : ""],
    ["Network sandbox verified", e.proven.network_sandbox === "DENIED_VERIFIED" ? "outbound denied, local work allowed" : ""],
    ["Dependencies reconstruct successfully", e.proven.dependency_reconstruction === "CLEAN_ROOM_OK" ? "clean-room from the lockfile" : ""],
    ["Verification is deterministic", `${e.proven.determinism} reproductions`],
  ];

  $("#main").innerHTML = `
    <div class="card frozen-card"><div class="card-title">Status</div><div class="card-value frozen">READY TO FREEZE</div></div>
    <h1 class="page-title">Review the rules before freezing</h1>
    <p class="page-subtitle">These conditions were proven by the eligibility check and will be frozen exactly as shown.</p>

    <h2 class="section-title">Proven facts</h2>
    <ul class="check-list">
      ${proven.map(([line, sub]) => `<li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">${esc(line)}</span> ${sub ? `<span class="sub-line">${esc(sub)}</span>` : ""}</span></li>`).join("")}
    </ul>

    <h2 class="section-title">Who</h2>
    <div class="kv">
      <span class="k">Payer</span><span class="v">${esc(d.payer_identity)}</span>
      <span class="k">Assigned worker</span><span class="v">${esc(d.worker_identity)} <span class="note">(single claimant — frozen for this worker only)</span></span>
    </div>

    <h2 class="section-title">What must be true <span class="badge frozen-tag">frozen</span></h2>
    <ul class="check-list">
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">The bug is fixed</span><span class="sub-line">${esc(d.regression_command)}</span></span></li>
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">Existing behavior stays healthy</span><span class="sub-line">${esc(d.baseline_health_command)}</span></span></li>
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">Only approved files may change</span><span class="sub-line">${esc(d.allowed_paths.join(", "))}</span></span></li>
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">Protected files cannot change</span><span class="sub-line">${esc(d.forbidden_paths.join(", "))}</span></span></li>
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">No dependency changes</span></span></li>
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">Maximum patch size</span><span class="sub-line">${esc(String(d.max_diff_lines))} changed lines</span></span></li>
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">Repeat verification</span><span class="sub-line">${esc(String(d.determinism_runs))} consecutive passes</span></span></li>
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">Network access</span><span class="sub-line">disabled during verification</span></span></li>
    </ul>
    ${n.summary || n.issue_url ? `<p class="note"><span class="badge unfrozen">Unfrozen context</span> ${esc(n.issue_url)} ${esc(n.summary)}</p>` : ""}

    <hr class="divider-strong" />
    <div class="card frozen-card" style="padding: 24px">
      <h2 class="section-title" style="margin-top:0">Before you freeze</h2>
      <p class="cardinal">If the assigned worker satisfies the Tier-1 conditions shown above and the result is independently replayed, the Tier-1 reward is earned.</p>
      <p class="cardinal"><strong>You cannot later turn that earned Tier-1 amount into discretionary review because you dislike the implementation.</strong></p>
      <div class="kv" style="margin-top:16px">
        <span class="k">Tier-1 reward</span><span class="v">${esc(d.tier1_reward)}</span>
        <span class="k">Assigned worker</span><span class="v">${esc(d.worker_identity)}</span>
        <span class="k">Rules</span><span class="v">8 frozen conditions</span>
        <span class="k">Tier 2</span><span class="v note">Not evaluated in this experiment</span>
      </div>
      <label class="ack-row"><input type="checkbox" id="ack" /><span>I understand that these Tier-1 rules cannot be changed after freezing.</span></label>
      <div class="actions">
        <button class="primary" id="btn-freeze" disabled>Freeze these rules</button>
        <button class="secondary" id="btn-back">← Edit configuration</button>
      </div>
    </div>`;

  $("#ack").addEventListener("change", (ev) => { $("#btn-freeze").disabled = !ev.target.checked; });
  $("#btn-back").addEventListener("click", () => renderPrepare(STATE));
  $("#btn-freeze").addEventListener("click", async () => {
    setBusy("Freezing — running the preflight once more and publishing the frozen generation…");
    try {
      await api("/api/freeze", { precommitAcknowledged: true });
      await refresh();
    } catch (err) {
      await refresh();
      alert(err.message);
    }
  });
}

/* ── phase FROZEN: freeze success ── */
function renderFrozen(state) {
  const f = state.frozen;
  $("#main").innerHTML = `
    <div class="card frozen-card"><div class="card-title">Status</div><div class="card-value frozen">FROZEN</div></div>
    <h1 class="page-title">The rules are now locked for this experiment.</h1>
    <p class="page-subtitle">The worker page and submission flow arrive in the next cuts (FR-3 · FR-4). The frozen facts below are final.</p>
    <div class="kv">
      <span class="k">Payer</span><span class="v">${esc(f.payer_identity)}</span>
      <span class="k">Worker</span><span class="v">${esc(f.worker_identity)}</span>
      <span class="k">Tier 1</span><span class="v">${esc(f.tier1_reward)}</span>
      <span class="k">Tier 2</span><span class="v note">not evaluated in this experiment</span>
      <span class="k">Base commit</span><span class="v mono">${esc(f.base_commit_sha)}</span>
      <span class="k">Frozen at</span><span class="v mono">${esc(f.frozen_at)}</span>
    </div>
    ${technicalDetails([
      ["contract freeze hash", f.contract_freeze_hash],
      ["ruleset hash", f.verification_ruleset_hash],
      ["precommit binding", f.precommit_binding],
      ["base SHA", f.base_commit_sha],
      ["preflight determinism", f.preflight?.determinism ?? ""],
    ])}`;
}

/* ── later phases (FR-3..FR-6 not yet implemented) ── */
function renderLaterPhase(state) {
  $("#main").innerHTML = `
    <h1 class="page-title">${esc(state.phase.replace(/_/g, " "))}</h1>
    <p class="page-subtitle">This phase belongs to FR-3…FR-6, which are not implemented in this cut. The facts strip above is live and derives from the experiment artifacts.</p>
    <div class="kv">
      <span class="k">Primary verification</span><span class="v">${esc(state.facts.primary_verification)}</span>
      <span class="k">Replay</span><span class="v">${esc(state.facts.replay)}</span>
      <span class="k">Tier-1 entitlement</span><span class="v">${esc(state.facts.tier1_entitlement)}</span>
      <span class="k">Payer response</span><span class="v">${esc(state.facts.payer_response)}</span>
      <span class="k">Ledger</span><span class="v">${esc(state.facts.ledger)}</span>
    </div>`;
}

function setBusy(msg) {
  $("#main").innerHTML = `<h1 class="page-title">${esc(msg)}</h1><p class="note">This runs the real frozen machinery — no simulation.</p>`;
}

/* ── router by phase ── */
function render(state) {
  STATE = state;
  renderHeader(state);
  if (state.transient.checking) return setBusy("Checking eligibility — running the real preflight…");
  if (state.phase === "DRAFT" || state.phase === "READY_TO_FREEZE") {
    // READY_TO_FREEZE is a review state; the payer may always go back and edit
    return renderPrepare(state);
  }
  if (state.phase === "FROZEN") return renderFrozen(state);
  return renderLaterPhase(state);
}

async function refresh() {
  const state = await api("/api/state");
  render(state);
}

$("#footer-details-toggle").addEventListener("click", () => {
  const el = $("#footer-details");
  el.hidden = !el.hidden;
  if (!el.hidden && !el.textContent) {
    el.textContent =
      "Experiment trust anchor (docs/experiments/EXPERIMENT-001.md):\n" +
      "  MAIN                    fe18be0a5eb9536a7d2e0325352cb6ed0d7bbc90\n" +
      "  implementation audit    ca0c64673a759a713c2cf18813cb22b7fc005741\n" +
      "  VERIFIER-RELEASE sha256 25286e96bd346bd34fa093d40968f690ae357a4d9ece59f9af6c925747cb6027\n" +
      "  portable-replay sha256  292d580430dbe39c2978060340d2e4d27dd8debcfc807ba5f0a5e6157cbc8493";
  }
});

refresh().catch((e) => {
  $("#main").innerHTML = `<h1 class="page-title">Cannot reach the orchestrator</h1><p class="error-note">${esc(e.message)}</p>`;
});
