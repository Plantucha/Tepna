<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: BRIEF-COLLISION-RESIDUAL-GAP-2026-08-09-BRIEF.md
---
Records what `guard-stale-brief.sh` reaches and what it cannot, because the belief that a guard covers you is what stops the next person looking. It **does** catch the sequential collision — the other PR already merged and you have fetched — which covers #1055, whose edits fall 80 minutes after #1034 merged; a branch *based* before a merge is not an *edit made* before it, and an earlier review claim that the hook "could not have prevented #1055" is corrected here. It **cannot** catch the concurrent collision: when two PRs are open at once and neither has merged, the information does not exist on `origin/main` for any local hook to find. That is not a corner case but the second occurrence the same day — #1059 and #1061, created three minutes apart on the same twenty lines, leaving `main` briefly asserting both a retraction and its rebuttal. Also records a wiring hole: the matcher is `Edit|Write`, a TOOL name, so every write arriving through `Bash` bypasses it, which is how all four computed edits to `DOCS-INDEX.md` and a brief were made in a single session. Proposes the fix in order of leverage — branch protection "require branches to be up to date before merging" (an owner action, and the only mechanism that sees both PRs because it runs when both exist), a PR-level stale-file CI check, and widening the matcher to `Bash`, which closes the wiring hole and does nothing for the concurrent case.
