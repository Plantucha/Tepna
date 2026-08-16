---
bump: patch
type: fixed
brief: BRIEF-COLLISION-RESIDUAL-GAP-2026-08-09-BRIEF.md
---

`land-pr` abandoned three of four PRs it was asked to land, each the same way: poll a few times, decide
the PR was green, issue `gh pr merge --squash`, get refused with "the base branch policy prohibits the
merge", and exit — leaving the PR with nothing holding it current. That is worse than never running it,
because the operator believes it is being tended.

The cause is structural rather than a name-matching slip. `decide()` fails closed in the two places it
documents, but the required-context-never-reported rule is gated behind `pending === 0`, so a single
**advisory** pending check switches it off. The function then reaches its merge branch having
established only that nothing *pending* is required — never that the required contexts exist at all.
Those are different questions and on this repo they come apart constantly: on the affected PRs `test`,
`test (py3.12)`, `test (py3.13)` and `browser-gates` had not reported at all, with `browser-gates`
existing only as `relevance (browser-gates)`, and the advisory `mutation` context masked all of it.

Adds one condition before returning `merge`: every required context must appear in `reported`. It fails
closed the same way as its neighbours — an unread ruleset leaves `required` empty and the rule is inert,
so it can only ever add waits, never merges.

This is the tool header's own #1183 lesson with the sign flipped. There an absence was read as evidence
of failure and produced a spurious `stuck`; here an absence is read as satisfaction and produces a
premature merge. Both are a missing measurement treated as a result.

Gated by four assertions in the `land-pr` group: the absent-required case waits, the verdict names the
contexts that never reported, an all-reported PR still merges past an advisory pending check (so the
#1259/#1269 90-minute stall is not traded back in), and an unread ruleset leaves the rule inert.
Verified by reverting the fix — the two new behavioural assertions fail with the exact production
string, `green and up to date (1 advisory check(s) still in flight)`.

Also records in `CLAUDE.md` §👥.5 that merge queue is **unavailable** here, not merely uneconomic: it
requires an organization-owned repository and `Tepna` is user-owned, confirmed three ways (the API
rejects a `merge_queue` rule outright, GraphQL reports `isInOrganization: false`, and GitHub documents
the feature as organization-scoped). Public visibility is not the discriminator — this repo is public
and still ineligible. The paragraph read as a cost decision, and a session was about to take fresh
cadence numbers to the owner arguing against a constraint that is not economic at all.
