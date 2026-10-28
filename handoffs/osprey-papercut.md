# Unit `papercut` — re-cut the cohort-pinned papers on today's code

**PR #4024, DRAFT.** `claude/papercut-osp` @ `82dab651e` in `wt-papercut-osp`, base `a47e59aaa`.
One commit, fifteen paths: seven papers, seven served `docs/papers/` copies, one changeset.

## Gates
- `npm run check`: `CHK_EXIT=0`, `✓ check — all 41 steps passed`, 14,571 assertions over 834 groups.
- `pr-compliance` in the covering form: PASS over nine checks, PR body included.
- `ste-lint --strict` clean on the PR body, the changeset and both board entries.

## Result
Six papers driven through `tools/analysis-rerun.mjs --paper-scale`, all `err: null`. Five reproduce
their most recent revision note cell for cell: nights-icc, cgm-hrv-coupling, treatment-response,
hrv-age-confound, qrs-yield. `rmssd-equivalence`'s optical arm moved further in September's
direction (+3.298 ms, +8.15 %, r 0.8057). No figure re-cut; each paper names its own panels that no
longer reproduce.

`ppg-ecg-hrv-validation` is NOT re-cut. Its corpus is reachable — 23 of its own nights inside its
stated window carry both raw streams — but no committed tool reproduces its 1,477-epoch alignment
and k-fit, so re-deriving it is a build unit.

## Next step
Kestrel undrafts, the PR lands, then ONE RESIDUE-only PR closes both rows and logs a new OPEN row
for the absent producer. Row 1's publish-or-retract call is the owner's.

Doc-search query that finds the prior work: `papers predate the detector fixes, re-cut published
numbers`.
