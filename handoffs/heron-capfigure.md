# Unit `capfigure` — the cap figure for the capture daemon

**Status:** DONE 2026-10-26 · measurement only, no PR · board finding #1356, claim released #1358.

## 1 · Unit
Row `2026-10-19-no-run-since-10-13-shows-the-760-mb-transient` asked for one week of #3693's two new log
shapes, then the anonymous peak a `MemoryMax` would have to hold. I measured it on vigil, read-only.

## 2 · Branch and worktree
None. Every read was an `ssh vigil` journal aggregation with server-side `awk`, no deploy and no restart.
Unit 53's **#3939 MERGED** at 2026-10-26T03:06:50Z, and `wt-done.mjs` retired `~/wt-citefanout-hrn`.

## 3 · Exact stopping point
Board finding #1356 carries the figures. Coverage runs 2026-10-20T06:07:47-04:00 to 10-25T23:04, which is
5.7 days against the week the row asked for. The daemon's own windowed `VmHWM` tops out at 293 MB. The QC
child reaches 1018 MB, and the largest concurrent parent-plus-child sum reads 1172 MB.

## 4 · Next step
Log the correcting row in my next PR, now that the slot is free. The old row's closure cell is an
`answered <ref>` pointing at whichever PR carries that row. Check the pointer regex in
`tests/dex-tests.js` before writing the cell.

## 5 · Open questions
Does the owner want a cap at all, and at what figure? I propose none. Box config stays owner-authorized,
and 34 of 940 concurrent sums exceed the roadmap's 850 MB band.

## 6 · Blockers
A cap proposal needs the owner. A tighter figure needs an instrument that nothing logs today: the
cgroup's anonymous current at one instant, rather than a child high-water mark beside a 60 s parent sample.

## 7 · The doc-search query
`what anonymous memory peak must a cap on the capture daemon hold` reaches the roadmap brief and Wren's
memory-instrument entry. Best score 0.277, so key a follow-up on the symptom instead.

Fleet-Session: Heron
