# Unit `seamdrain` — the sweep row's cost premise gets a number

**PR #4029, DRAFT.** `claude/seamdrain-osp` @ `a25456a4d` in `wt-seamdrain-osp`, base `ef4eb7605`.
Two commits, RESIDUE-only: two state cells, one new row, one changeset. No code moved.

## Gates
- `npm run check`: `CHK2_EXIT=0`, `✓ check — all 41 steps passed`, 14,571 assertions over 834 groups.
- `pr-compliance` over the live PR body: PASS over nine checks.
- `residue-ids` against the committed ledger: `1 row(s) added, none colliding, none mutated`.

## The measurement
The row claimed a refusal would red every sweep in the shared root, because sessions write root files
continuously. A probe watched the root's 191 suite-relevant paths every 5 s for 1802 s at load
average 12.78 to 33.93, with three other birds gating: **0 seams**, and 0 of 351 evaluated
50-second mutant windows carry one. The criterion of 10 % was pre-stated on the board before the run.
The bound is one-sided: 0 of 351 puts the share under roughly 0.9 %.

The instrument is the shipped code. `tools/mutate.mjs` runs a sweep on import, so the probe slices
`driftWatchList`, `sampleTree`, `treeDrift` and `seamAt` out of its committed text, evaluates them,
and records the slice's sha (`05a1a0bcee68`).

## Rows
`answered #4029` for the sweep row; the papers-predate row closed against #4024; one new OPEN row for
the absent `ppg-ecg-hrv-validation` producer. `2026-09-07-ppg-ecg-hrv-paper-predates-the-fill-removal`
stays OPEN: its evidence cell names a re-run nobody can run and an owner decision nobody has made.

## Next step
Kestrel undrafts, the PR lands, then `node tools/wt-done.mjs` on the worktree. The ledger is the hot
file tonight, so rebase and re-run `residue-ids` if the merge waits.

Doc-search query: `a sweep whose input moved annotates rather than refusing`.
