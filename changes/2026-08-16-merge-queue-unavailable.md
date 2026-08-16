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

Docs only.

