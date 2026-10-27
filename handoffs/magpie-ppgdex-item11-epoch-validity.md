<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — PpgDex punch-list item 11, epoch validity by time (Magpie)

**Unit:** `briefs/PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` item 11. **Landing order now**
`4 ✅ → 12 ✅ → 8 ✅ → 1 ✅ → 6 ✅ → 7 ✅ → 2 ◐ → 10 ✗ → 11 ✅ → 5 → [9 experiment]`.
**Rule 0:** `epoch validity per-band minimum duration spectral resolution floor` →
`ppgdex-dsp.js` [chunk 167/259] · `capture-host/nightqc.py:2243-2267` ·
`briefs/REM-STAGING-REDESIGN-2026-07-28-BRIEF.md:75-93`.

## Where this stopped (2026-10-19 20:55Z)

**DRAFT #3703** — `claude/epochval-mg` at `3f614a738`, worktree `~/wt-epochval-mg`, board
entry #279. Four commits: the DSP change with its witness pair, the brief stamp with the changeset, the
static-mirror repair, and the header reword with the corpus stamp.

- `npm run check` → **all 39 steps passed**, run with `DEX_UPLOADS=~/Tepna/uploads`, so the
  13 coverage legs a bare worktree skips actually ran.
- `node tools/verify-fixtures.mjs` over the corpus → suite green, one fixture stamped
  (`PpgDex_2026-06-27_equiv.node-export.json verifiedUnder → 780042f7c44b`), 18 already current.
- `node tools/rebase-safe.mjs` rebased onto `origin/main`. The rebuild moved 14 artifacts, every one of
  them carrying `ppgdex-dsp.js` inline, and `git show HEAD:<file> | grep -c` confirmed the marker in both
  source files after the amend.

## What shipped

A covered span of `S` seconds resolves nothing below `1/S`. A band whose UPPER edge sits at or below that
floor reads `null` with `bandReason: 'span-below-band-resolution'`. A band that loses only its LOWER edge
counts as truncation, so it keeps its value and carries `spanSec`. `totalPower` refuses with any refused
band, because it means the sum of the reported ones. `lfhf`, `lfnu`, `hfnu` and `respRate` each read
`null` when their own inputs do. The export's epoch projection carries `spanSec` always and `bandReason`
only when it fires.

## What the next session needs to know

- **This corpus refuses nothing.** The shortest covered span over 1099 epochs runs 35 s, well above every
  band's threshold. The change buys a bound. Do not look for a moved value to prove it works.
- **The gates cannot witness it.** The regen moved 6 fixtures and only `manifestHash`, `computeHash` and
  the new `spanSec` moved. Two seeded tests carry the behaviour, and they come as a pair because
  `JSON.stringify(NaN)` reads `null`.
- **The inner-gap threshold stays open.** 5 of the 1098 epochs report across a gap over 60 s. Pick the
  number from a measured gap distribution, never from those 5 — that reads a threshold off the data it
  judges. That one owes a residue row once somebody measures it.
- **The three-cycle minimum durations the row asks for do not ship.** They null the VLF of every epoch
  here, and the whole-record fallback is the grid lottery the deep audit rejected.

## Next step

Watch #3703's checks, let the walker undraft it in queue order, then
`node tools/wt-done.mjs ~/wt-epochval-mg`. After that the punch list leaves item 5 (ACC —
Kestrel's lane, do not take it) and item 9, the autogain experiment, which the row itself says to measure
before merging.
