---
bump: patch
type: fixed
brief: none
---

guard-format.sh finds Biome instead of going silent when a worktree has no `node_modules` - the environment CLAUDE.md section-people-1 mandates, and where 20 of 58 worktrees on this box were blind when measured. It now searches this checkout, then $DEX_BIOME, then the PRIMARY checkout's pinned binary (derived from `git rev-parse --git-common-dir`, never hardcoded), and runs it with cwd at the worktree root. That cd is load-bearing and now says so: Biome discovers biome.json by walking up from the CWD, not from the path it is handed, so the same binary on the same file reports a clean result from inside the worktree and a lint/style/useTemplate error by absolute path from outside - borrowing a binary without the cd invents violations in clean files. If Biome is still unreachable the guard still denies nothing, but says so ONCE per session and prints every path it looked at, because a silent pass and an unrun check were indistinguishable - which was the defect. The self-test had the same blind spot it tests for: its `ln -s $REPO/node_modules` dangles in a fresh worktree, so every DENY case scored ALLOW and the run reported nine failures that read as a broken hook; it now resolves Biome the same way and SKIPs loudly rather than reporting false failures.
