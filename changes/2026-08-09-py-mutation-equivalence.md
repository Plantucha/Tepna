---
bump: patch
type: fixed
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---

The diff-scoped mutation gate on PR #1090 reported 6 survivors in `_session_matches`, and the PR merged
anyway because the job is advisory — a red nobody can clear becomes a red nobody reads, which the gate's
own header names as how a gate dies.

Five were real gaps and are now killed, each verified by re-applying that exact mutant: `len(parts) >= 3`
weakened to `> 3` and `>= 4` (every fixture had five parts), `parts[-3]` to `parts[-4]` (every fixture had
a digit at `[-4]`, so both indices agreed), and the `< 180` window to `<= 180` and `< 181` (no fixture sat
on the boundary). All five are edges of a predicate the same PR introduced.

The sixth cannot be killed by any input: the weakened tail guard admits two extra shapes and both then
fail `strptime` and return False down the same path. Probed over 133,495 generated names, zero
differences.

`capture-host/tools/mutate_diff.py` had no equivalence concept at all, so its only outcomes were "killed"
and "fails forever". It now carries the mechanism its JS sibling got in #1060 — keyed on the mutant's
DIFF rather than mutmut's `__mutmut_N` index, which was observed renumbering the same mutation between
runs (12 in CI, 6 locally). REFUTED, ORPHANED and unclassified all fail loudly and were each exercised
end-to-end, not reasoned about.

Also: `.gitignore` carried `.venv/` with a trailing slash, which matches directories only — so the venv
symlink a worktree test run creates was not ignored.
