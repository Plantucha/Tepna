# osprey — unit `unitcost`: what unit each backlog enumerator walks

**Doc-search query that finds the prior work:** "what unit does a corpus walk enumerate" → `tools/corpus-reads.mjs`
`UNWIRED_BACKLOG`, `tools/corpus-scope.mjs` `snapshotNights` / `snapshotEntries`, the closed year-pin row.

## Unit

Classify all 44 `UNWIRED_BACKLOG` names by the unit their own walk yields, say which primitive each
needs, and log a row if the measurement finds a defect. Measurement only, no code from this half.

## Where it stands

Done and reported: board entry #1352 in thread #7, addressed to Kestrel. Scripts in the session
scratchpad under `unitcost/`: `unit.mjs` (first pass), `final.mjs` (hand-verified tally with a control).

Result: file 25 names / weight 29 · night 12 / 15 · record 5 / 7 · day 1 / 2 (`cpap-corpus.mjs`,
8-digit folders) · neither 1 / 1 (`dual-clock-rate.mjs`, which lists only inside an error probe).

Two findings worth a row, both waiting on a slot:

1. `snapshotEntries` (`tools/corpus-scope.mjs:285`) returns `rule: null, ruleIsDefault: true,
   rejectedNightShaped: null, admittedNonNight: null` as literals, so a file-unit caller's filter is
   never recorded and `ruleIsDefault: true` asserts a default that did not apply. This blocks the file
   unit for 25 of the 44 names.
2. `beat-comb-analysis.mjs` published `of N night(s)` where N summed its own three outcome bins. My
   held PR fixes that line; the row records the shape for the other tools that print a derived
   denominator.

## The PR half

`claude/wire14-osp` @ `5a085e126` in the sibling worktree `wt-wire14-osp`, rebased onto main after #3937
merged, tree clean, all three changes verified present. The amend folded in the closure-denominator
fix and the extended message. The full gate runs detached; its log is `check-wire14.log` in the
scratchpad's `unitcost/` directory.

## Next step

Read the gate's `EXIT=` sentinel. On green: push with `--force-with-lease` and open the PR with the
`Rule 0:` line first, the `Fleet-Session: Osprey` trailer and the attribution trailers. Take the number
from `gh pr view`.

## Open questions

The owner still holds the year-pinned night rule (board #1347), the sandbox question (#1336), the nsrr
record population (#1254) and decision #1310.

## Blockers

One open PR per bird, so the owed rows wait for the wire14 PR to merge. The row batch needs a fresh
worktree cut from the ref, never my primary checkout's copy of the ledger.
