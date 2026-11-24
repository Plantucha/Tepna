---
name: worktree-to-pr
description: Use when starting a work unit in this repo or opening a pull request — the per-session worktree, staging by explicit path, the changeset, and the three things a PR body must carry for the required compliance gate to pass. Use before the first edit of a unit, and again before pushing or opening the PR.
---

# Worktree → changeset → PR

Sequence only; rules live in `CLAUDE.md` §👥.1, §👥.2 and §📌.

0. Read the open PRs and the last merges: `gh pr list --state open` and `git log --oneline origin/main -10`.
   Pick work whose files are far from what is in flight. Two PRs on one DSP make a fixture stale with no
   git conflict. Finish your open PR before you start the next one.
1. `git worktree add ../wt-<task>-<3 chars> -b claude/<task>-<3 chars> origin/main`. The per-session
   suffix stops two sessions deriving one branch name for one defect.
2. Work there. Never write a file in the shared root checkout: the sync timer cannot fast-forward it
   when a root file also moved on main. Stage by **explicit path** only — the blanket forms are hook-denied in a shared
   checkout, and unrecognised files are another session's work unit.
3. `node tools/new-changeset.mjs --slug=<slug> --bump=patch|minor|major --type=fixed|added|changed`,
   then replace the TODO line with one imperative sentence.
4. Commit with `Fleet-Session:` in the last paragraph, beside the other trailers. A blank line between
   them makes git drop it: check with `git show -s --format=%B HEAD | git interpret-trailers --parse`.
5. Run `node tools/secret-scan.mjs`. Its exit code is the verdict. It is a required check on `main`.
6. Push, then `gh pr create --draft`. The walker undrafts it. Do not name another project in a title,
   a body, a comment or a changeset; describe the behaviour and the measurement. The body needs all four or `tools/pr-compliance.mjs` reds it: a
   `Rule 0: <query> → <top hits>` line (first by convention), the `Fleet-Session: <Name>` trailer,
   a `changes/` changeset when code moved, and **no finding from `node tools/ste-lint.mjs body.md`**
   (owner, 2026-10-12: the writing rules bite; the gate runs the strict form over the body).
7. Take any PR number from `gh pr view`, never from memory.

## Measured

A body edit alone does **not** re-run the compliance gate — it reads the trigger payload — so an absent
line costs an empty commit plus a second CI round-trip. `release-land.mjs` generated bodies with no
Rule 0 line and reded every release PR until #3428.

`cd X && <cmd> &` backgrounds the **cd** as well, so a later `git status` or `new-changeset` in the
same command runs in the shared root. That put a changeset in the wrong checkout on 2026-10-11.
`git -C <path>` is the only truthful form.

A session typed a PR number from memory before the PR existed, and had to revert it the same day.

Memory: `failed-cd-runs-in-the-shared-root`, `query-state-never-memory`,
`check-inflight-prs-before-picking-work`, `fleet-session-trailer-goes-in-the-trailer-block`,
`secret-scan-before-push`, `write-only-in-own-worktree`, `no-third-party-project-names`.
