#!/usr/bin/env python3
"""Dependency-free structural validation of report/conformance-report.json
against the key constraints of schema/conformance-report.schema.json (an
inline subset: required fields, enums, patterns, and the PASS/FAIL/UNKNOWN
evidence rules). Exits non-zero on any violation."""
import json
import re
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
report = json.loads((here / "../report/conformance-report.json").read_text(encoding="utf-8"))

HEX64 = re.compile(r"^[0-9a-f]{64}$")
CHECK_ID = re.compile(r"^[A-Z][A-Za-z0-9-]*(#[0-9]+)?$")
errors = []

def err(msg):
    errors.append(msg)

for field in ["report_id", "generated_at", "harness", "sut", "provenance", "summary", "results", "attack_surfaces"]:
    if field not in report:
        err(f"missing top-level field: {field}")

h = report.get("harness", {})
for f in ["name", "builder", "independence", "reproduce_all"]:
    if not h.get(f):
        err(f"harness.{f} missing/empty")

sut = report.get("sut", {})
for f in sut.get("snapshot_files", []):
    if not HEX64.match(f.get("sha256", "")):
        err(f"sut file digest malformed: {f.get('file')}")

s = report.get("summary", {})
for k in ["PASS", "FAIL", "UNKNOWN"]:
    if not isinstance(s.get("counts", {}).get(k), int):
        err(f"summary.counts.{k} missing")
if s.get("gate_status") not in ("NOT_READY", "READY_WITH_EXCEPTIONS", "READY"):
    err("summary.gate_status invalid")
if "frozen" in s.get("freeze_declaration", "").lower() and "does not declare" not in s.get("freeze_declaration", "").lower():
    err("report must not declare the schema frozen")

seen_ids = set()
fail_count = unknown_count = pass_count = 0
for r in report.get("results", []):
    cid = r.get("check_id", "")
    if not CHECK_ID.match(cid):
        err(f"malformed check_id: {cid}")
    if cid in seen_ids:
        err(f"duplicate check_id: {cid}")
    seen_ids.add(cid)
    st = r.get("status")
    if st == "PASS":
        pass_count += 1
    elif st == "FAIL":
        fail_count += 1
        if not r.get("evidence", {}).get("failure_messages"):
            err(f"{cid}: FAIL without failure_messages evidence")
    elif st == "UNKNOWN":
        unknown_count += 1
        if not r.get("rationale"):
            err(f"{cid}: UNKNOWN without rationale")
        if r.get("unknown_kind") not in ("gap_documented", "blocked"):
            err(f"{cid}: UNKNOWN without valid unknown_kind")
    else:
        err(f"{cid}: invalid status {st}")
    if not r.get("evidence", {}).get("test_file"):
        err(f"{cid}: PASS/FAIL/UNKNOWN without bound test file evidence")
    if not r.get("reproduce"):
        err(f"{cid}: missing reproduce command")

fb = s.get("freeze_blockers", [])
unknowns_src = json.loads((here / "../unknowns.json").read_text(encoding="utf-8"))["unknowns"]
expected_fb = {k for k, v in unknowns_src.items() if v.get("freeze_blocking")}
got_fb = {x.get("check_id") for x in fb}
if expected_fb != got_fb:
    err(f"summary.freeze_blockers mismatch: expected {sorted(expected_fb)}, got {sorted(got_fb)}")
for x in fb:
    if not x.get("ruling") or not x.get("rationale"):
        err(f"freeze blocker {x.get('check_id')}: missing ruling/rationale")
    cid = x.get("check_id")
    ev = [r for r in report.get("results", [])
          if r["check_id"] == cid or r["check_id"].startswith(cid + "#") or r["check_id"].startswith(cid + "-")]
    if x.get("status") not in ("OPEN", "DISPOSITIONED"):
        err(f"freeze blocker {cid}: invalid status {x.get('status')}")
    if x.get("status") == "DISPOSITIONED" and not ev:
        err(f"freeze blocker {cid}: DISPOSITIONED without matching check evidence")
    if x.get("status") == "DISPOSITIONED" and ev and not all(r["status"] == "PASS" for r in ev):
        err(f"freeze blocker {cid}: DISPOSITIONED but matching checks are not all PASS")
    if x.get("status") == "OPEN" and ev and all(r["status"] == "PASS" for r in ev):
        err(f"freeze blocker {cid}: all matching checks PASS but status is OPEN (should be DISPOSITIONED)")

if s.get("counts", {}).get("PASS") != pass_count or s.get("counts", {}).get("FAIL") != fail_count or s.get("counts", {}).get("UNKNOWN") != unknown_count:
    err(f"summary.counts mismatch: declared {s.get('counts')} vs actual P{pass_count}/F{fail_count}/U{unknown_count}")

for a in report.get("attack_surfaces", []):
    if not re.match(r"^AS-\d+$", a.get("id", "")):
        err(f"attack surface id malformed: {a.get('id')}")
    if a.get("severity") not in ("high", "medium", "low"):
        err(f"{a.get('id')}: severity invalid")
    if not a.get("evidence"):
        err(f"{a.get('id')}: no evidence refs")

if errors:
    print("REPORT INVALID:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
print(f"report structurally valid: P{pass_count}/F{fail_count}/U{unknown_count}, {len(report['attack_surfaces'])} attack surfaces")
