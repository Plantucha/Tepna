<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The mutation scratch now carries the repo-root files a test reads — the `writers.py` lane had been
refusing since 09-16.

`tools/mutate.py` copies `capture-host/` ("copy EVERYTHING a test reads from disk") and nothing above
it. `tests/test_seam_sidecar.py` opens `../ecgdex-dsp.js` for the seam-bound parity check, so inside
the scratch the clean baseline failed with `FileNotFoundError`, and every mutant of the module came
back "0 tested". Surfaced 2026-09-19 on #2675 by the refuse-on-zero guard; the identical failure sits
in #2581's log, the PR that added the test, hidden then because that guard did not exist.

`mutation_diff.root_reads(tree)` DERIVES the set — a test file naming, as a string literal, a regular
file in the repo root (dotfiles excluded: `.git` is a file in a worktree) — and
`stage_root_reads` copies each to BOTH places a `tests/../..`-shaped read resolves from (`work/` for
the mutants run, `work/..` for the baseline), on scratch creation and on reuse. Keyed on what is read,
not on the path idiom; over-flags by design (four merely-mentioned names cost four small copies).
Measured: the writers.py baseline inside a fresh scratch went from `1 failed` to clean.
