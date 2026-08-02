<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: TOOL-INVOCABILITY-SWEEP-2026-08-02-BRIEF.md
---
`tools/mutate.mjs` buffered a whole sweep to the end, so a long run showed nothing until it finished — and a kill lost everything.

Both modes now report **per file, as each completes**:

- `--json` emits **NDJSON** — one compact object per line, flushed as it lands. Greppable, `jq`-able line by line, and whatever finished before an interrupt is still on disk.
- The human mode prints each file's block immediately, then a closing roll-up: `── 71 file(s) measured, 0 skipped ── 612/1420 killed = 43 % (of 38102 mutants that exist)`.

That roll-up is new and answers the only question that spans files: how much of this codebase can the suite actually see? Previously it had to be re-aggregated by hand from the per-file output.

Found by running a 71-file sweep and watching a zero-byte output file for twelve minutes — the same shape as a gate whose result you cannot see until it is too late to act on.
