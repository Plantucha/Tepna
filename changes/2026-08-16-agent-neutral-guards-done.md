---
bump: patch
type: changed
brief: AGENT-NEUTRAL-GUARDS-2026-08-15-BRIEF.md
---

`AGENT-NEUTRAL-GUARDS` read `PROPOSED` with four open boxes while being fully executed, and its §4
proposed building a detector that had shipped two months earlier.

All four verified 2026-08-16. §3 shipped as #1330 (`tools/commit-shape.mjs`, wired into `npm run check`
and the always-runs `static` job, 30/30 releases pass with 0 false positives, exemption by declared
provenance rather than by shape, exit 2 on a shallow clone) and was independently mutation-checked —
four boundary mutants, all killed. Both `CLAUDE.md` boxes were already satisfied: the file states that
"hook-enforced" is narrower than it reads, that prevention cannot be made agent-neutral, and that §2c
has no mechanical detector.

§4 was never built here because it already existed. `.github/workflows/stale-file.yml` (#1086) computes
this brief's specified property line for line — same merge-base diff, same guarded set of briefs plus
`DOCS-INDEX.md`, same `fetch-depth: 0` — and the brief's second complication is quoted verbatim in that
workflow's own header. The piece genuinely missing was enforcement: the check was advisory while
auto-merge is used on essentially every PR, so it reddened a PR and merged it anyway. #1337 made it the
8th required context on `protect-main`.

The declared-override marker §4 asked for is rejected with a reason rather than deferred: rebasing
advances the merge-base and empties the overlap, so rebase is already the escape hatch — and it is the
one that forces you to read the upstream commits first, which is the whole point of the check. A
PR-body marker would let someone skip exactly that step.

Records the gap that remains and has no detector: two briefs holding the same question in different
files. `stale-file` looks for the same path touched twice and is structurally blind to it. Measured the
same day, when `HOSTAXIS-STABILITY-FOLLOWUPS` §3 and `INTERDISCIPLINARY-LITERATURE` line 271 turned out
to be tracking one question independently.

Docs only.
