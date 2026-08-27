---
bump: minor
type: added
brief: CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17-BRIEF.md
---

`tools/dual-clock-rate.mjs` now emits a **per-fragment `ppmUncertainty`** with the τ it was read at,
closing the `[~]` box that declared itself not closable from inside. Fully delegated: the residuals about
its own fitted line are already a phase series in ms, and `clock.js`'s `allanFromPhase`/`allanSlope` do
every line of the statistics.

⚠️ **The obvious implementation is wrong by ~300×, and the corpus says so.** σ_y at the house reference
τ (256 s) reads **317 ppm** for an H10 fragment whose rate is −19.1 ppm and whose three fragments agree
to **1.1 ppm** across a night. That number is real — BLE delivery jitter at short averaging times — but
it is not the uncertainty of a rate fitted over 295 minutes, and a 317 ppm bar **makes every spread
explicable**: the exact fabricated-error-bar failure `crystalVerdict`'s no-uncertainties fallback exists
to prevent. It would have satisfied the box's letter while defeating its purpose.

**Quoted instead: σ_y at τ = the fragment's own span**, reached by extrapolating along the fitted Allan
slope from the longest *measured* point (~4×, anchored on data). The slope is used numerically and **no
noise type is named** — the spine refuses to name one near a boundary and nothing here needs it.

| fragment | span | rate | σ_y at span |
|---|---|---|---|
| H10 | 295.4 min | −19.1 ppm | 3.43 ppm |
| H10 | 199.4 min | −19.3 | 4.79 |
| H10 | 87.6 min | −18.2 | 10.60 |
| Verity | 162.0 min | −25.5 | 18.33 |

Three checks the 256 s version failed: the bars **bracket** the observed 1.1 ppm inter-fragment spread,
they **shrink with span**, and a drawn-axis fragment still yields **no bar**.

**The χ² branch is now reachable** — entries with bars return a finite `chi2` (80.66 on a planted wide
spread) where the same entries without return `note: 'no uncertainties; raw-spread bound only'`.
`crystalCoherence` surfaces `chi2` and `note` so a reader sees *which branch decided*; collapsing both to
a boolean is how the fallback stayed invisible. The `spread ≤ MAX_CRYSTAL_SPREAD_PPM` fast path is
untouched. §🔒.7 is honoured: the bar never travels without its τ.

Gates: `crystal-single-source` 14/14, `independence` 34/34, docs-ledger 38/38, typecheck + biome clean.
