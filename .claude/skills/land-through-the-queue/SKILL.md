---
name: land-through-the-queue
description: Use when a finished PR has to reach main — the draft handoff to the walker, the Mergify queue, what BEHIND actually means, the WIP cap, and removing the worktree afterwards. Use when a PR is green and waiting, and before touching a queued run.
---

# Land a PR through the queue

`CLAUDE.md` §👥.5 and `.mergify.yml`. Mergify replaced Kodiak on 2026-11-18
(`changes/2026-11-18-kodiak-cutover.md`).

- **Open it as a draft.** The walker undrafts a green draft while fewer than 4 PRs are out of draft.
  `merge_protections_settings.auto_merge_conditions` queues every non-draft PR without a
  `do-not-merge` label, so arming auto-merge adds nothing. A `do-not-merge` label or Draft is the only hold.
- **Mergify tests a batch of up to 4 PRs on a `mergify/merge-queue/` draft PR**, then squashes each.
  The walker skips those branches. Never push to one or close one.
- **BEHIND is not a block.** The `protect-main` ruleset is no longer strict (2026-11-18), so a PR
  that is BEHIND main can merge, and Mergify tests it on top of main itself. Do not update a BEHIND PR
  only to make it current. Merge `origin/main` only to resolve a conflict, and push **once**.
- **The author lands the PR** unless they hand it over. A second `gh pr update-branch` on a current
  branch adds a merge commit and restarts every check, so two drivers cost a full lap.
- **A capture-host PR carries no deploy hold** (owner, 2026-11-02). vigil defers the daemon restart
  while the box records.
- **WIP cap: ≤4 open non-draft PRs repo-wide.** A finished unit waits for a slot.
- **Never supersede a queued `tests` run under ~3 h.** And a body edit alone does not re-run
  `pr-compliance` (it reads the trigger payload) — push an empty commit after fixing a body.
- After the merge: `node tools/wt-done.mjs <path>` from `~/Tepna`, **one path per call**. Remove a
  `node_modules` symlink first. If it refuses as IN USE, LIST with `pgrep -af` and then `kill` the
  numeric PIDs — two commands, never one that carries its own pattern (§👥.4).

- Then advance the local main: `git -C <root> merge --ff-only origin/main`. Report the HEAD.

## Measured

`wt-done.mjs` refused a merged unit's tree as IN USE by four `node -e setInterval(()=>{},1000)`
keep-alive stubs whose cwd was inside it, started at the exact minute something killed each of my gate runs
(2026-10-12). They were mine; I still had to list and read them before the kill, because a
`pkill -f <pattern>` whose own command line contains the pattern kills itself — the tell is exit 144
on your own call.

A PR that is DIRTY gets **zero** workflow runs while other PRs keep landing (#3400, 2026-10-11), so a
conflict is not a slow queue: resolve it with `node tools/rebase-safe.mjs`, then verify the change
survived (`git show HEAD:<file> | grep -c <identifier>`).

Memory: `pr-author-owns-the-landing`, `open-prs-as-draft-the-walker-undrafts`,
`capture-host-prs-carry-no-deploy-hold`, `sync-local-main-after-merge`.
