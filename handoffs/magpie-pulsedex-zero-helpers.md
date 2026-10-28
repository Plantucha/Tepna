<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the PulseDex half of `2026-10-06-zero-on-empty-dsp-helpers` (Magpie)

**Unit:** residue row `2026-10-06-zero-on-empty-dsp-helpers`, PulseDex half. The ECGDex half is the
#3567 closure.
**Doc-search query that found the prior work:** `dsp helper returns 0 for an empty or too-short input
absence as value` → `tests/dex-tests.js:19700-19800` · `ecgdex-dsp.js` · `briefs/RESIDUE.md`.
**Branch / worktree:** `claude/pdzero-mg` in `wt-pdzero-mg`. Board entry #430.

## What shipped

Three helpers in `pulsedex-dsp.js` answer `null` for an input too short to measure: `std` under two
values, `sdsd` under three, `medianOf` on an empty array. A flat series has a sample SD of exactly 0,
so the old `0` told the next caller "measured, and flat" about nothing measured. `_pdOrNull` mirrors
ECGDex's `_rmOrNull` and carries the `null` through five rounding sites.

No exported number moves. All 20 call sites guard a short input upstream today: `pdComputeResult`
refuses under ten beats, `windowAnalysis` needs 20 per window, `_pdSeriesStats` needs 3,
`compareIntervalSeries` needs 5 matched beats, the window medians need 3 windows.

## The finding worth carrying

**A deferral's price is often written in the gate it names.** Two records priced this half in hours:
the row `2026-10-18-four-pinned-files-keep-their-unused-variables`, and the test comment the #3567
closure left behind. Both named the `treatment-response · pinned yield` pin as the blocker. That pin's
own failure text prices this page's re-cut at ~1005 s measured 2026-09-28, and sanctions a re-stamp on
the same counts for a provably inert edit. The cheaper instrument sat inside the thing doing the
blocking. The "hours" figure was `analysis-rerun.mjs`'s generic 120-minute timeout default, read as a
measurement of this page.

**The typecheck, not the suite, found the work.** Seven TS errors landed at exactly the five rounding
sites where the type system cannot see a length guard that lives in a caller. The suite stayed green
through the change, because no reachable path feeds a short input.

## Next step

This branch owes nothing further. Two findings this unit did not fix, each owing a row when a
RESIDUE-only slot frees:

- `winSpec.respRate` falls back to `0` when no window yields a respiration rate, in
  `pulsedex-dsp.js` and in the `pulsedex-app.js` mirror. It moves an exported number, so it owes its
  own unit.
- The mispricing above deterred this half for 14 days. The row should name the gate text as the
  cheaper instrument.
