<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23-BRIEF.md
---
Mutation-harden `oxy_transfer.verify()` — kill the 15 diff-scoped survivors I logged when I withdrew the string-artifact claim. Measured, not reasoned: ran the actual mutants (`mutate.py oxy_transfer --only 'x_verify__*'`) and triaged each by ID. All 15 were real and killable (none no-distinguishing-input) — the failure-path tests asserted the reason but not `VerifyResult.depth` or `.size`, so `depth→None`, `size→None/1`, and reason wrap/case mutants across the unreadable/size-mismatch/not-finalised/bad-header/non-whole/count-mismatch branches all survived. Fixed by asserting the full result (depth + size + exact reason) on every failure path; re-ran mutmut → 109/109 killed, 0 survivors. Test-only; 100% coverage held.
