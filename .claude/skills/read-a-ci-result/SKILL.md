---
name: read-a-ci-result
description: Use when reading CI on a PR or deciding whether to re-run a check — the aggregate-not-tail rule, which run may be re-run, why a stale re-run cancels the fresh one, and the failures that examined nothing. Use before calling a check red, and before re-running anything.
---

# Read a CI result

`CLAUDE.md` §4b (a truncated result is not the verdict) and §4c.

- **Never read a verdict off a `tail`.** Aggregate:
  `gh pr checks <N> --json bucket --jq 'group_by(.bucket)|map({(.[0].bucket):length})|add'`, or a
  `TOTAL` / `Required` line. Capture `$?` **before** any pipe; tail afterwards for detail only.
- **Re-run only the run whose `headSha` equals the PR head** (`gh run list --json headSha,databaseId,
  conclusion`). A green on an older sha does not satisfy a required context on the head sha.
- **Never re-run while a push is in flight.** A run started on the old sha cancels the fresh run
  through the workflow's concurrency group — and a cancelled check reads as `pend=0`, so a waiter
  calls it terminal.
- A **DIRTY** PR registers no check set at all. A waiter must gate on the *expected total*, never on
  "nothing pending".
- `tools/residue-ids.mjs --check` reads **HEAD**, not the worktree. Commit before believing it.
- A CANCELLED job at its `timeout-minutes` may have examined nothing — read the step log before
  attributing it to your diff.

## Measured

On #3462 (2026-10-12) `browser-gates` CANCELLED twice for two different reasons. Once at its
`timeout-minutes: 20` inside *Install Playwright*, last line an `archive.ubuntu.com … InRelease`
fetch, with sibling PRs finishing that same step in 35 s–4 min: an apt-mirror stall, nothing about the
diff. Once because a re-run of an **older** attempt cancelled the fresh run on the head sha; the PR
only reached CLEAN after `gh run rerun <id>` on the head-sha run itself.

A `git push --force-with-lease` in the same hour returned a bare `! [remote rejected] … (failure)`
with no reason, and the identical command immediately after succeeded — transient, not a lost lease.
Re-read the remote head before concluding someone took the branch name (§2d).

Memory: `kodiak-owns-the-drain`.
