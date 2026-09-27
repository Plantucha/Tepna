<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [analysis, tools]
brief: TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md
---
The fused-weight three-cornered hat now reaches the committed-corpus paths: `tools/derive-sigma-window.mjs`
writes the DSP's per-second confidence as a header-named `c` column (omitted, not defaulted, across a
clock seam), `analysis-stats.js parseDerivedHr` / `confidenceSeries` parse it single-sourced, and both
`sigma-no-reference-analysis` (`buildWindow`) and `sensor-trio-power-analysis` (`loadReal`) run the fused
hat when a file carries it and the classic hat when it does not — with the within-window CI following the
point (F16). The power tool's private copy of the classic hat is replaced by delegation to the shared kernel
and covered by the delegation-parity leg. Closes TCH-FUSED-ROBUST-HAT (owner-ordered, 2026-09-26).
