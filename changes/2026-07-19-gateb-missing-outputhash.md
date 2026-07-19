<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
`gateBEvaluate` graded a fixture record carrying **no `outputHash`** as `reproducible` — the one fail-**open** path in a function whose every other branch fails closed.

The output-drift check was guarded `rec.outputHash && outNow !== rec.outputHash`, so a record with nothing recorded skipped the comparison entirely and fell through to `reproducible`, whose own detail string reads *"output pinned @ …"*. A historical record took the same path to `historical-ok` / *"byte-pinned"*. Both asserted a pin that did not exist.

GATE B is a **content-addressed known-answer** ledger. A record with nothing to compare the bytes against is *unpinned*, not reproducible. It now reports `no-output-hash` and counts as a failure, like every sibling branch.

Mirrored in `tests/reconcile-provenance.mjs`, which had the identical guard and reported such a record as "output unchanged" — asserting a comparison that never ran. It now lists them under `UNPINNED` with the hash to record.

**Latent on today's ledger** — all 25 committed fixtures carry an `outputHash`, so nothing changes now. That is precisely why it was worth closing: a hand-added or half-written record would have been graded green **on arrival**, and GATE B is what stands between a stale fixture and a release. No re-bundle, no fixture movement.

§12.2's third sub-item — *"verify `computeHashFromText` is actually live"* — was checked and is **already satisfied**: the probe runs in the Node lane with real hashes (3 self-test assertions), closed by the browser co-load work in v1.14.0. Recorded rather than redone.

7 new assertions driven through the real `gateBEvaluate`, covering both record kinds and both directions. Mutation-verified: restoring the `rec.outputHash &&` guard grades an unpinned code-gated record `reproducible` and an unpinned historical record `historical-ok`, both with `fail: 0` — the defect exactly.
