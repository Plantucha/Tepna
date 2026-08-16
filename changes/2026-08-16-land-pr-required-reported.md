<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---

`land-pr` merged past required contexts that had never reported, and then abandoned the PR when
GitHub refused. Two independent defects; four sessions were exposed to both.

**1 · One ADVISORY pending check switched off the missing-required-context rule.** That rule is gated
behind `pending === 0`, so a single advisory check in flight disabled it entirely — and the merge
branch was then reached having verified only *"no PENDING check is required"*, never *"every required
context reported and passed."* Those are different questions and on this repo they come apart
constantly. The mechanism (#1293): `suite (shard 1/6)` is pending and is **not** itself required, so
`requiredPending` is 0, while the required `test` rollup only lands once all six shards finish and had
therefore **never reported at all**. A required context that is ABSENT reads identically to one that
is SATISFIED if you only count buckets. The fall-through is now gated on the reported **set**.

`wait`, not `stuck`, deliberately: `stuck` means waiting cannot help and is only sound once nothing is
pending; here something IS pending, so an absent context is LATE rather than never-coming.

**2 · A refused merge abandoned the PR while looking like success.** `gh pr merge` throws when GitHub
disagrees with the snapshot, and that throw escaped the poll loop, so the tool exited having done
nothing further while the operator believed the PR was being tended. Measured 2026-08-16: three of
four runs in one session died this way; a fourth, in another session, left a PR sitting BEHIND with no
runner. **Worse than never running the tool**, because a dead lander and a quiet one are
indistinguishable. A refusal now means *our model was wrong* — it re-snapshots and keeps tending,
bounded at 3 refusals so an unlearnable refusal cannot become an infinite merge loop.

This is the toolchain's own recurring defect, now found in the tool that decides whether work ships:
an **absence read as satisfied**, because the only rule that inspects absences was disabled by
something unrelated to it. Defect 2 is why it cost a day rather than an hour — quitting looked like
finishing.

**Attribution.** The `decide()` fix is **not original to this PR.** It existed as an uncommitted
modification in the shared checkout, was never committed anywhere, and its author is unknown — it was
found and preserved by a peer session as `rescue/2026-08-16-land-pr-wip` after its verdict string
turned up in a log with no matching source in any commit, branch or worktree. Its reasoning is better
than the independent reconstruction that was about to replace it (it names #1293's shard-rollup
mechanism and the wait-vs-stuck distinction), so it is used as written. Only the merge-refusal fix,
the tests, and this note are new here.

Gate: `tools · land-pr` 33 assertions. The three new assertions were **seen to fail** against the
unfixed code (`got "merge" · want "wait"`) before being trusted; a fourth pins the converse — every
required context reported ⇒ an advisory pending still merges — so the gate cannot pass by refusing
everything, which is how a hastily-added guard usually goes wrong.
