# Magpie — unit: the TCH family reports its night population

- **Unit:** residue `2026-10-21-sixty-eight-corpus-enumerators-still-measure-whatever-set-they-caught`, first slice (6 of the 68).
- **Branch:** `claude/corppop-mg` · **worktree:** `wt-corppop-mg` (cut from `origin/main` at `c1f0c37b0`).
- **PR:** #3850 (DRAFT).

## State at the stopping point

Eleven files changed, one changeset added. `npm run check` reads EXIT=0 with 40/40 steps on
`9d0b431bd`, the head the PR carries, with zero failure-mark lines.

## What the unit does

Six TCH tools snapshot the night set before they enumerate and again after they score, then print a
`corpus-population` verdict over the intersection. The scored nights come out of that snapshot, so
one walk serves both. `tools/corpus-reads.mjs` now counts a `snapshotNights` call as an enumeration,
because a delegated walk had dropped each wired tool out of the hazard set.

## Next step

62 corpus enumerators still measure whatever set they catch. `node tools/corpus-reads.mjs` names
them, and `UNWIRED_BACKLOG` holds the 35 that need wiring. Take the next family the same way: one
walk, one snapshot, one verdict.

Osprey holds the other half of the same census (board #848 and #851) and lands second on
`tools/corpus-reads.mjs`. That half decides the 28 tools the origin tracer abstains on, and it
touches `originOf`, `declarations` and `parameters`, which this PR leaves alone.

## Open questions

- `tch-reference-validation.mjs` needs an external volume no machine here carries, so its wiring has
  never run. Row: `2026-10-21-the-reference-validation-population-path-runs-on-no-box-here`.
- Its night filter pins `2026-`. Row: `2026-10-21-the-reference-validation-night-filter-is-pinned-to-one-year`.

## The search that found the prior work

`node tools/doc-search.mjs "tool reports the night population it covered corpus enumerator populationVerdict"`
