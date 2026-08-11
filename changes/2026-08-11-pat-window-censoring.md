---
bump: patch
type: fixed
brief: PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md
---

PAT gate: `PHYS = [200,650]` was applied as a plausibility filter but is a censoring cut — where the
inter-device offset puts the true R→foot lag outside it, the window keeps an edge-biased remnant and
every statistic below is computed on that. It discarded most of the data on 16 of 19 box site-nights,
including one at 97.4 % that still produced a confident PAT number. `coupledPAT` now reports
`censoredPct` (measured by re-pairing with no window, bounded only by 0.9 × the local RR) and
`PATGate.verdict` refuses `WINDOW-CENSORED` above 2 %. Scoped to the analysed beats, not the file, so a
clean night whose device axis steps elsewhere in the recording survives. No existing bar moves; absent
or NaN `censoredPct` leaves behaviour unchanged.
