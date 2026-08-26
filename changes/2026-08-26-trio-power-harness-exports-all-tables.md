---
bump: patch
type: fixed
brief: TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md
---

`tools/trio-power-headless.mjs` exported **one** of the four simulation tables the
`sensor-trio-nights` paper publishes — the ±0.15 minN column, which is a threshold crossing on a
coarse grid and which the tool's own printed warning already calls the least trustworthy statistic
it produces. The σ̂ **bias** table (both regimes) and the **ρ negative-variance** grid were computed
by the page on every run and discarded at the `page.evaluate` boundary. Both are continuous, so they
are what a reproduction can actually be checked against.

Both are now extracted and printed. An all-null ρ grid **refuses (exit 2)** instead of printing a
well-formed row of dashes that is indistinguishable from a genuine all-zero result — the grid is read
from `rhoSweep` directly, which returns the grid itself rather than a `{grid}` wrapper.

**This is what closed box 2 of the brief, and the answer is negative.** At the paper's stated 720
trials/cell the run is byte-identical on repeat, and: dynamic bias reproduces (≤0.006); the **resting**
bias table does not (H10 −0.589 vs a published −0.473) and is recovered to **0.002** by reverting the
planted σ to the superseded interim triple 1.7/2.2/3.0 — so that table belongs to the pre-re-plant
generation, which is Blocker 2's silent-desync failure one level up. The ρ table reproduces under
**neither** σ set (current code needs ρ≈0.7 to print what the paper labels ρ=0.3), so a second change
is also in that history. Table 1 is itself a composite of three runs. No paper content was changed —
the standing instruction against swapping re-derived σ into it is untouched, and this finding
strengthens that gate rather than lifting it.
