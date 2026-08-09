<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: BRIEF-COLLISION-RESIDUAL-GAP-2026-08-09-BRIEF.md
---
Step one of enabling a GitHub merge queue, which is the mechanism chosen to close §2's concurrent-collision gap: it tests each PR against the tip it will actually land on, giving the same guarantee as "require branches to be up to date" without the rebase tax a repo merging ~15 PRs an hour would otherwise pay. A queued PR is gated on the same required checks as a normal one, but those fire on the `merge_group` event — and **none of the seven required checks listened to it**, so enabling the queue first would have jammed every merge in the repo waiting on checks that never run. This wires `merge_group:` into the six workflows behind those checks (`tests`, `no-network`, `typecheck`, `biome`, the two `capture-host` Python jobs, `browser-gates`) and changes nothing else — every existing `push`/`pull_request` trigger is untouched, so behaviour before the queue is enabled is identical. The ruleset flag is deliberately NOT flipped in this change: the safe order is CI-first, and the reverse is an outage.
