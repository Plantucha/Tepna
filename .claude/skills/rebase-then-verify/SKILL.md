---
name: rebase-then-verify
description: Use when a pull request is BEHIND, DIRTY or has a merge conflict in this repo, or before any rebase — which tool to run, why a generated conflict and a source conflict need opposite treatment, and the one command that confirms your change survived. Use whenever a PR shows BLOCKED or DIRTY and you are about to rebase it.
---

# Rebase, then verify

Rules: `CLAUDE.md` §2c and §2d.

1. **First ask whether a rebase is needed at all**:
   `git merge-base --is-ancestor origin/main origin/<branch>` — true means the branch already contains
   main (often Kodiak's base merge) and the only correct action is to wait.
2. `node tools/rebase-safe.mjs` — auto-resolves generated conflicts, rebuilds, and **stops** on a
   source conflict instead of picking a side.
3. If it stops: resolve each source file by hand. For `tests/dex-tests.js`, restore main's copy and
   **re-run your insertion** — never keep one side wholesale. A regenerated artifact (a golden, a
   bundle) is resolved by taking either side and **re-running its builder**, which is what makes the
   choice irrelevant.
4. **Verify your change survived, every time**:
   `git show HEAD:<file> | grep -c <an identifier your change adds>`
5. Push with `--force-with-lease` only, after `git log --format='%an' origin/<branch> -3 | sort -u`.

## Measured

`BLOCKED` names a state, not a cause. On 2026-10-11 it meant "Kodiak already base-merged" once and
"behind main" twice; rebasing on the status word alone was wrong one time in three, and the lease
caught a force-push that would have discarded Kodiak's merge.

`rebase-safe` treats `uploads/` goldens as **source** and stops on them even though
`regen-<node>-goldens.mjs` regenerates them — expect to resolve those by hand, then regen.

Memory: `base-merge-is-queue-mechanics`, `ahead-in-commits-behind-in-content`.
