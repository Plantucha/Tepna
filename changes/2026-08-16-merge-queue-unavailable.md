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

If merge queue is wanted, the question is repository ownership, not throughput. Docs only.
