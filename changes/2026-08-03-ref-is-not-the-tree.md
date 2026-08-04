<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
`git update-ref` on a checked-out branch is now denied — it is the one form that skips git's own worktree check.

Syncing local `main` with `git update-ref refs/heads/main refs/remotes/origin/main` looks like the
careful option because it avoids `checkout`/`pull`. It is the opposite: `update-ref` is plumbing — it
moves the ref, touches neither the working tree nor the index, and is the ONLY form that skips git's
checked-out-branch check. `git fetch origin main:main`, `git branch -f` and `git push .` all refuse by
name; `update-ref` succeeds silently.

If the branch IS checked out, that tree freezes while HEAD advances, so every file a later merge adds
reads as deleted. Measured 2026-08-03: a blanket add then staged 214 entries including 47 live-file
deletions, 25 of them pending changesets — growing with each merge rather than converging.

Also fixed: the blanket-staging rule matched the RAW command, so `grep "git add -A" CONTRIBUTING.md`
was denied while trying to READ the rule it documents. It now matches a quote-stripped form — a real
invocation is unquoted and still caught. A guard that blocks reading its own documentation is a guard
someone turns off.

**Deliberately NOT added: a commit-time guard on deletions.** It was built, tested, and discarded.
Deleting files that exist on `origin/main` is what deleting a file *is*, so the rule fires on every
legitimate removal — and it would block `tools/release.mjs`'s changeset prune (105 pending today),
making the override routine. The rejected design and the reason are recorded in `CLAUDE.md` §2b so it
is not re-proposed.
