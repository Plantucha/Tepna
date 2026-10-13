---
name: land-through-the-queue
description: Use when a finished PR has to reach main — the draft handoff to the walker, Kodiak's serial queue, what BEHIND actually means, the WIP cap, and removing the worktree afterwards. Use when a PR is green and waiting, and before touching a queued run.
---

# Land a PR through the queue

`CLAUDE.md` §👥.5 and `.kodiak.toml`.

- **Open it as a draft.** The walker undrafts when the non-draft open count reaches zero.
  `require_automerge_label = false`, so every non-draft PR is *already* in Kodiak's serial queue —
  arming auto-merge adds nothing, and a `do-not-merge` label or Draft is the only hold.
- **BEHIND while the front PR is mid-CI is serialising, not stalling.** Only when a green PR sits
  BEHIND for >15 min: `git merge --no-edit origin/main` locally and **one** push — not
  `gh pr update-branch` followed by a second push.
- **WIP cap: ≤4 open non-draft PRs repo-wide.** A finished unit waits for a slot.
- **Never supersede a queued `tests` run under ~3 h.** And a body edit alone does not re-run
  `pr-compliance` (it reads the trigger payload) — push an empty commit after fixing a body.
- After the merge: `node tools/wt-done.mjs <path>` from `~/Tepna`, **one path per call**. Remove a
  `node_modules` symlink first. If it refuses as IN USE, LIST with `pgrep -af` and then `kill` the
  numeric PIDs — two commands, never one that carries its own pattern (§👥.4).

## Measured

`wt-done.mjs` refused a merged unit's tree as IN USE by four `node -e setInterval(()=>{},1000)`
keep-alive stubs whose cwd was inside it, started at the exact minute something killed each of my gate runs
(2026-10-12). They were mine; I still had to list and read them before the kill, because a
`pkill -f <pattern>` whose own command line contains the pattern kills itself — the tell is exit 144
on your own call.

A PR that is DIRTY gets **zero** workflow runs while other PRs keep landing (#3400, 2026-10-11), so a
conflict is not a slow queue: resolve it with `node tools/rebase-safe.mjs`, then verify the change
survived (`git show HEAD:<file> | grep -c <identifier>`).

Memory: `kodiak-owns-the-drain`, `arm-automerge-at-creation`.
