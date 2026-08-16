---
bump: patch
type: changed
brief: BRIEF-COLLISION-RESIDUAL-GAP-2026-08-09-BRIEF.md
---

`CLAUDE.md` §👥.5 already stated that GitHub's auto-merge does not update a branch. Three sessions
deadlocked on it anyway on 2026-08-16: 14 open PRs, every required context passing, zero pending, zero
failing, and nothing merging for hours.

The fact was there; the framing was wrong. It sat inside "a window open well under half the time", which
reads as a probabilistic race that patience eventually wins. It is not probabilistic. With
`strict: true`, an armed, fully green, BEHIND PR never becomes mergeable on its own — waiting has zero
probability of success, and someone must update the branch. Measured on four of mine that afternoon: the
one updated when green merged; the three left armed and green sat BEHIND indefinitely.

That consequence is now stated rather than left to be derived: merges are strictly sequential, because
every merge to main re-BEHINDs every other open PR. Updating N branches at once is waste — all N re-run
CI, the first to finish merges, and the other N−1 go BEHIND again. Update one, let it land, update the
next. At roughly nine minutes a cycle, a fourteen-deep queue takes over two hours to drain however green
it is, which is a better argument for fewer simultaneous PRs than the race framing was.

The cadence figures are re-measured with their window stated, because the value depends on it: today's
28 merges give a median gap of 8.6 min with 13 of 27 gaps ≥ 10 min, while sampling the last 40 merges
instead gives 13.1 min, since that window reaches back days and swallows an 88-minute lull and a 5-day
gap. Same repo, same hour, two answers. The prior figure carried no window at all.

Also records that when you have something to push anyway, `git merge origin/main` locally and a single
push beats `gh pr update-branch` by a full CI cycle — one head and one run, rather than a remote merge
commit followed by a second head.

Docs only. Split out of #1369, which shipped the §👥.5 merge-queue availability note and §👥.2d without
this half.
