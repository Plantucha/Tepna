---
bump: patch
type: changed
brief: BRIEF-COLLISION-RESIDUAL-GAP-2026-08-09-BRIEF.md
---

`CLAUDE.md` §👥.5 rejects a merge queue on cost grounds — "the numbers say the self-inflicted
serialisation is the bigger term" — which reads as a decision that fresh throughput numbers could
reopen. It cannot be reopened that way, because merge queue is not available on this repository at all.

GitHub scopes the feature to organization-owned repositories. `Tepna` is user-owned, confirmed three
independent ways: the API rejects a `merge_queue` rule outright even with no parameters (recorded
2026-08-09 in `BRIEF-COLLISION-RESIDUAL-GAP` §4 and in `stale-file.yml`'s header), GraphQL reports
`isInOrganization: false`, and GitHub's documentation scopes it to organization repositories. Public
visibility is not the discriminator — this repo is public and still ineligible, which was a plausible
enough hypothesis that it needed ruling out rather than assuming.

Recorded because the omission had a measured cost on 2026-08-16: a session was about to take fresh
cadence numbers to the owner arguing against a constraint that is not economic at all, and would have
had the availability blocker discovered for them. The two facts lived in `stale-file.yml` and a brief;
neither is where someone reads before proposing a change to merge policy.

If merge queue is wanted, the question is repository ownership, not throughput.

Also adds §👥.2d, a hazard class no hook in this repo can see. Two sessions independently produced the
branch name `claude/land-pr-required-reported` for the same defect on 2026-08-16; one pushed and opened
a PR, the other had committed the same name locally. That is likely rather than coincidental, since
branches are named after the fix and one defect yields one slug. The collision is on the remote, between
two private trees, so `guard-shared-tree.sh` structurally cannot detect it — every other hazard in §👥 is
visible somewhere locally.

The safe failure is already built in: a plain `git push` to a diverged branch is rejected as
non-fast-forward, and that rejection on a branch you believe is yours alone is the warning rather than an
obstacle to force past. `--force-with-lease` refuses on unseen commits and is what made this a near-miss
instead of a destroyed PR. A per-session branch suffix prevents the collision, but note the asymmetry:
the suffix prevents the collision while the lease prevents the loss, and only one of those is
recoverable.

Also corrects §👥.5's cadence figures and, more importantly, its framing. The numbers are re-measured
over a stated window — today's 28 merges, median gap 8.6 min, 13 of 27 gaps ≥ 10 min, CI ≤ 9 min — and
the window is stated because the value depends on it: sampling the last 40 merges instead of today gives
a 13.1 min median, since that reaches back days and swallows an 88-minute lull and a 5-day gap. The
prior figure carried no window at all.

The framing fix is the load-bearing half. §5 already said auto-merge does not update the branch, and
three sessions still deadlocked on it on 2026-08-16 — 14 PRs with every required context passing, zero
pending, zero failing, nothing merging. The sentence sat inside "a window open well under half the
time", which reads as a probabilistic race that patience wins. It is not probabilistic: an armed, green,
BEHIND PR never becomes mergeable on its own. Measured on four of mine that afternoon — the one updated
when green merged, the three left alone sat indefinitely.

That makes merges strictly sequential, since every merge re-BEHINDs every other open PR, so updating N
branches at once is waste: all N re-run CI, one merges, N−1 go BEHIND again. The protocol is update one,
let it land, update the next — and at ~9 min a cycle a 14-deep queue takes over two hours to drain
however green it is.

Docs only.

