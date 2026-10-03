# EVIDENCE-SCENE-RECON — `evidence/3b941db2…` local deletion

Order: `EVIDENCE-SCENE-RECON = GO` (Commander ruling, 2026-10-03).
This record is the incident report required by that order. It is
deliberately short and factual. **No replacement directory was created.**

```text
ORIGINAL PATH
  packages/golden-path/evidence/3b941db2-b233-4755-9b95-4dd77552374f/

KNOWN PROVENANCE / PURPOSE
  GP2 execution-evidence generation created 2026-09-28 07:04 (local),
  from the same session that produced the OFFICIAL tracked rerun
  3886799a-1baf-4a1a-a2c8-e2bce0a8791c (created 2026-09-28 08:03,
  committed under MAIN-CLOSURE-R1). Same file-set shape:
  artifacts.json / bundle.json / manifest.json / raw/
  (agent-patch.bin, base-acceptance.bin, build.bin,
  execution-manifest.bin, patched-acceptance.bin, policy-boundary.bin).
  Never tracked by git; zero references anywhere in the repository.
  Its exact role in the 2026-09-28 session is NOT established by this
  record — that is precisely the provenance gap the loss creates.

LAST OBSERVED STATE (2026-10-03 ~16:03 local, session `ls -la`)
  artifacts.json  4368 bytes  mtime 2026-09-28 07:04
  bundle.json     1125 bytes  mtime 2026-09-28 07:04
  manifest.json   2082 bytes  mtime 2026-09-28 07:04
  raw/            6 .bin files (names above; sizes never captured)
  NO hashes were captured before deletion. Sizes/names above are the
  only surviving descriptors; they do NOT constitute a byte inventory.

DELETION
  date/session : 2026-10-03 ~16:17 local (Asia/Shanghai), ZCode session
  command      : rm -rf <original path>
  reason       : misclassified as test residue — untracked, zero repo
                 references, superseded by the tracked 3886799a sibling,
                 and breaking the V3.12 clean-tree gate. The ruling
                 classifies it as a historical evidence scene whose
                 preservation outranked the gate. Misclassification is
                 the incident; "V3.12 GREEN" does not adjudicate it.

RECOVERY SEARCH (exhaustive, 2026-10-03)
  git object database (all refs)      = 0 objects reference the UUID
  git dangling blobs / lost-found     = 0
  git stash                           = empty
  other worktrees (3: ip-main-verify,
    intent-pda-hardening, intent-pda-r1)
                                      = only the two TRACKED dirs exist
  Spotlight (mdfind) + find across
    /Users/xinquanwang (excl. Library), /private/tmp, /tmp
                                      = no hit
  APFS local snapshots (tmutil)       = none exist
  Time Machine                        = no destinations configured;
                                        no backup volume mounted
  ~/.Trash                            = absent (rm -rf bypasses Trash)
  remote / CI                         = impossible by construction —
                                        the dir was never tracked, so it
                                        never left this machine

BYTES RECOVERED
  NO

RECOVERY SOURCE
  N/A

HASHES (if recovered)
  N/A — none were captured before deletion (see LAST OBSERVED STATE)

STATUS
  MISSING / UNRECOVERED

EXPLICIT STATEMENT
  Regenerated evidence is NOT equivalent to historical evidence.
  Even if an identical-looking generation could be re-run, it would be
  a NEW artifact, not the 2026-09-28 scene; it must never be placed at
  or confused with the original path. No such regeneration was
  performed. The V3.12 green tree is now green because nothing is
  there — which is the recorded loss, not a resolution.
```
