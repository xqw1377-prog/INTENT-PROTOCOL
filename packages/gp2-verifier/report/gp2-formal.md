# GP2 Formal Black-Box Replay Report

- Generated: 2026-09-21T16:38:31.406Z
- Target: `b0d7f39f6033612b094b44189b03253306c0c5ab` (parent `d4c685bc`)
- Run: `9f6610dc-24e9-4e6c-b7c1-67574064d2ae` / fingerprint `1d626618-4506-4ed3-8af3-839aacc658cf`
- Checks: **16 PASS / 0 FAIL / 0 UNKNOWN**
- Machine gate: **READY** — machine READY != GP2 PASS — Commander signs.

| id | status | title |
|---|---|---|
| F0.1 | PASS | [F0.1] pinned target + parent + diff scope |
| F1.1 | PASS | [F1.1] task_freeze_hash / suite sha / base / paths / attempts |
| F2.1 | PASS | [F2.1] verifier main live subtree == signed G1 subtree; target sources import live wire, zero snapsh |
| F3.1 | PASS | [F3.1] six blobs: sha256(commit bytes) == payload_hash == locator suffix; schema-valid; unique ids |
| F4.1 | PASS | [F4.1] hashes/order/root/SEALED/content_hash/report agreement; 1-byte mutation breaks |
| F5.1 | PASS | [F5.1] fingerprint from frozen inputs; run_id fresh & canonical; run-scoped artifacts; payload-bound |
| F6.1 | PASS | [F6.1] committed bundle_id == independent pre-seal-body derivation |
| F6.2 | PASS | [F6.2] reverse artifact_hashes: root SAME, content_hash & bundle_id CHANGE (same run) |
| F6.3 | PASS | [F6.3] mutate policy_hash: bundle_id changes |
| F6.4 | PASS | [F6.4] omit one artifact: root AND bundle_id change |
| F7.1 | PASS | [F7.1] base seeded-red; committed patch reproduces all-green; build green; semantics observed |
| F7.2 | PASS | [F7.2] attempt beyond frozen max rejected by the independent executor too |
| F8.1 | PASS | [F8.1] task/base/patch/attempt/commands/outcomes agree |
| F9.1 | PASS | [F9.1] task hash drift / base drift / suite drift are all detected by recompute |
| F9.2 | PASS | [F9.2] forbidden-path patch + post-seal bundle mutation rejected |
| F10.1 | PASS | [F10.1] no verifier/decision/receipt/settlement/payment/devnet implementation in target gp-execution |
