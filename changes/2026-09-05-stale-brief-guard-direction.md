<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tooling]
brief: none
---
`guard-stale-brief.sh` documented one failure direction and had two.

Its header said the guard "can under-report, never over-report". That is true of a stale
`origin/main` — commits it has not fetched cannot be listed — and **false of a stale HEAD**. The base
is `merge-base(HEAD, origin/main)` of the tree the hook RESOLVES, so a tree that has fallen behind
makes the range list commits the author's actual tree may already contain: a false denial. Three were
measured in one session on 2026-08-20.

Residue `2026-09-05-sync-main-skips-while-root-dirty` names what keeps it stale: `tepna-sync-main.timer`
refuses to fast-forward the shared root while it holds uncommitted paths — correct, and deliberately
unchanged here — and a dirty root is the normal state. Measured 42 commits behind at 02:15 on rig-x870
with 7 dirty paths, while `systemctl show` reported `Result=success`, so the skip is invisible above
the log.

**Re-derived rather than taken from the row.** The row proposes the hook should stop depending on the
shared root's HEAD when run from a worktree. Measured against a fixture with the root 1 commit behind
and a worktree at `origin/main`, it already does not: an ABSOLUTE `file_path` and a leading `cd <dir>`
both identify the tree, and both ALLOW an edit in the current worktree while still DENYing one in the
stale tree. The exposure was that **none of that was pinned by a test** — nothing would have caught a
regression reintroducing the 2026-08-20 false denials.

So this adds those four cases plus the fixture's own non-vacuity check (which caught a broken fixture
during development: cloning the bare upstream without `--branch main` checks nothing out, and the two
ALLOW cases passed empty until the check failed). The residual no-signal route — no `file_path`, no
parseable `cd` — is pinned as the behaviour it HAS: it measures the hook's own cwd, and can deny only
while that tree is stale, since a current tree makes the base `origin/main` and the range empty by
construction. That is exactly when its answer is unreliable, so it is recorded as a limitation rather
than endorsed.

The header now states both directions and which one applies to the ref versus the tree.
