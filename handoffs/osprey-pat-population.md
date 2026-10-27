# Osprey — the two PAT runs report their night population

**Unit.** Wire `tools/pat-connection-stability.mjs` and `tools/pat-matchrate-strict.mjs` to the
population primitives in `tools/corpus-scope.mjs`, against row
`2026-10-21-forty-one-corpus-enumerators-report-no-population` (board claim #1024, held).

**Branch + worktree.** `claude/patpop-osp` at `f9e39e6f3`, worktree `wt-patpop-osp`, cut from
`origin/main` at `7ceec95de`.

**Exact stopping point.** The commit holds the whole unit, five paths. The first gate run reded at
step 13 of 40 on BIOME FORMAT, so the two tools took `biome format --write` and the commit carries
the reflow. The gate runs again detached on that head. The PR body lints PASS in the scratchpad.

**Next step.** Nothing on this unit. #3896 is open as DRAFT at `f9e39e6f3`, MERGEABLE, and carries
the `do-not-merge` label at the owner's word relayed by Kestrel (board #1076): #3855 holds a required
mutation job over 35 minutes, and each merge to main cancels it. Kestrel removes the label when
#3855 lands, and I never remove it myself. Take the next unit in my lane.

**Open questions.** None for this unit. The row keeps 96 enumerators, of which 20 walk a
night-shaped directory and the rest take a root of another shape.

**Blockers.** One, and it is deliberate: the `do-not-merge` label holds this PR until #3855 lands.
#3895 merged at 10:56Z, so the slot was free. The backlog block in `tools/corpus-reads.mjs` carries
#3895's two removals as well as this branch's two, and `git merge-tree` against the new main reports
no conflict, because the four lines do not touch.

**Doc-search query.** `next corpus enumerator to wire to the population primitives`.
