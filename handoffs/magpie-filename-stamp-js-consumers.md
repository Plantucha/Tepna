<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the JS consumers of a capture filename stamp (Magpie)

**Unit:** part (b) of residue `2026-09-22-filename-stamp-still-wrong-for-other-consumers`, JS half.
**Doc-search query that found the prior work:** `filename stamp consumers convert a capture filename
into an instant` → `briefs/RESIDUE.md:603-604` · `changes/2026-10-19-clock-filestamp-one-owner.md` ·
`capture-host/timeline.py:87-103 · _stamp_ms` · `memory/magpie-state-2026-10-18.md:384-403`.

## Where this stopped (2026-10-20 05:15Z)

Shipped as **DRAFT #3743** — `claude/namestart-mg` @ `4854eb611`, worktree
`~/wt-namestart-mg`, board entry #410. `npm run check` EXIT=0 over all 39 steps on the
final head. No bundle and no fixture moved, so no `manifestHash` and no `computeHash` move.

The two experiment tools now read `OVERLAP_MAX_GAP_MS = 24 * 3600 * 1000` for the filename-stamp
pre-filter, with the derivation beside the constant, and `ppg-fusion-e3.mjs --selftest` pins the bound
above the measured 18.7 h name error. `briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md` carries
a verdict per file for all ten JS converters and keeps the remainder as named units.

## Next step

Not this unit's remainder. My next is **§5 of `briefs/CVHR-HOLE-EDGE-EXCLUSION-2026-10-19-BRIEF.md`**:
the mirrored exclusion window in both nodes, `cvhrIndex` losing the excluded seconds from its
denominator, and a named refusal when no resolvable span remains. It moves both bundles and all six
PpgDex fixtures, so run `node tools/build.mjs --app PpgDex` before `tools/regen-ppgdex-goldens.mjs`,
then the corpus lap.

## The remainder of THIS unit, free for anyone

- `dex-ingest.js stampMs` builds `Date.UTC` from unvalidated components, which the Clock Contract §2.7
  forbids, and the instant feeds a 24 h nearest-sidecar pick. **Node-local, never `DexClock`** — the
  build puts `dex-ingest.js` into four bundles and `PpgDex.html` carries no `clock.js`. Shared-module
  work: announce it first, four `manifestHash` values move, and it owes the corpus lap. 0 of 454
  Polar-named corpus files violate the ranges today, so it is a tripwire.
- `sensor-trio-night.js`, `sensor-trio-power-analysis.js` and `sigma-no-reference-analysis.js` key the
  night a file belongs to on its filename. All three publish figures, so each repair owes its
  night-count delta in the PR.

## Carry these forward

- **Doubt the assignment's census.** This one said the population was never enumerated, and the census
  row had already split the 17 files 12 / 4 / 1. Rule 0 turned a sweep into ten file readings.
- **A corpus walk without `-L` reads 2504 of 33388 files and looks complete.** The root is mostly
  symlinks and the tools' own walker follows them. The tell was the endpoint's own printed total.
- **`find -name "*POLAR*"` is case-sensitive** and returned 0 where `-iname "*polar*"` returns 454.
- **ste-lint will not split a sentence at `. #NNNN`**, because a sentence has to start with a capital.
  Two findings in the PR body were one merged sentence that read as two.
