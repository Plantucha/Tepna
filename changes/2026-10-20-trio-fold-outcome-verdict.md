<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Give the trio fold a verdict over its outcome, so a night with a failed node reads FAIL, not PASS.

The gate verdict judges admission before any node runs, and its console line now says `admitted` instead of `folded`.
The new `trio-batch-fold` object counts the trio node-exports on disk for each admitted night.
It names every short night with its count.
Measured on `2026-09-11`: the old run printed `PASS — 1 folded` over 2 of 3 exports, and the new run prints `fold verdict : FAIL — 0 of 1`.
The exit code does not change, so the fold timer still commits a partial night.
Residue: `2026-10-20-three-accepted-trio-nights-lose-ecg-to-the-fs-merge-bound` (the verdict half).
