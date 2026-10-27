# Heron — unit 83, `cpapshield`

## 1 · Unit

Row `2026-10-26-the-shielded-cpap-teardown-has-no-reader`. Nothing reads the `shield()` in the CPAP
poller's teardown, and the measurement says nothing can: for this call shape the shield has no
consequence. The comment above it named a mechanism that does not hold, so the comment was the defect.

## 2 · Branch and worktree

`claude/cpapshield-hrn` in `~/wt-cpapshield-hrn`, base `ef522124d`, two commits pushed:

- `b362cbd38` — the corrected comment at `capture-host/capture.py:11103-11115`, a new leg in
  `capture-host/tests/test_cpap_poller.py`, and `changes/2026-10-26-cpap-teardown-release-names-its-mechanism.md`.
- `fee57d8e3` — `briefs/RESIDUE.md` line 937, state cell `OPEN` to `fixed #3979`.

PR **#3979**, DRAFT. Claim #1514 on the board, finding #1516.

## 3 · Exact stopping point

`capture-host/check.sh` reads `CH_EXIT=0`, `11454 passed, 3 skipped in 76.68s`, `TOTAL … 100%` and
`Required test coverage of 100% reached`. `npm run check` runs detached into `/tmp/h83gate.log` behind an
`NPM_EXIT=` sentinel, with a deadline-guarded waiter watching it.

The measurement, all of it reproducible from the two plant arms below:

| arm on `capture.py:11115` | the new leg reads |
|---|---|
| shipped | `1 passed`, and the file reads `40 passed in 0.22s` |
| the `shield()` removed, bare `await asyncio.to_thread(…)` | `1 passed` — the finding |
| the release removed altogether | `1 failed` — so the leg has a reader |

The control that makes the null result a measurement: a standalone probe over a coroutine awaitable calls
the inner function once shielded and ZERO times bare, while the `to_thread` shape calls it once either
way. `asyncio.to_thread` submits to the executor before its first suspension, so the submission carries
the release.

## 4 · Next step

Read `NPM_EXIT=` from `/tmp/h83gate.log`. On `0`, post both verdicts to board thread 7 and ask Kestrel to
undraft #3979, because I never undraft my own. On anything else, read the failing step's own verdict line
rather than the aggregator's.

## 5 · Open questions

- `wifi_join.py:155-160` points future resume work at "the existing `wifi_down` shield" as a template. The
  corrected comment now sits at the site that note points to, so I left the note alone. A reviewer may
  want a clause there as well.
- The 16 enumerated literal defaults stay OPEN as the owner's call: delete them, or enter them in
  `capture-host/tools/mutate-equivalence.json`.

## 6 · Blockers

None for this unit. The one-PR cap binds the next one: unit 84 may measure and prepare, and it opens
nothing while #3979 is in flight.

## 7 · The doc-search query that finds this work

`node tools/doc-search.mjs --read "does any test detect removing the shield from the cpap poller teardown"`
→ board #1501, `capture-host/tests/test_cpap_poller.py:291-320`, memory
`a-defence-with-no-reader-may-be-inert`.
