---
bump: minor
type: added
brief: O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md
---

**Two open O2Ring findings implemented: the aperiodic buzz correlation tool (buzz brief step 2/3's
analysis half) and the missing nightly RTC-drift digest line.**

`tools/buzz-fiducial-correlate.mjs` — correlates a commanded APERIODIC buzz sequence against the ring's
own motion channel and reports the host-axis residual. Detects the motion spikes (step 1 measured the
buzz as ~1.1 s, motion is the detector), then aligns them to a commanded relative-gap schedule; because
the gaps are aperiodic the alignment is UNIQUE (the mod-one-beat ambiguity that defeats a rhythmic tap
cannot occur), and the spread of (onset gap − commanded gap) IS the residual. A measured constraint the
build surfaced: each commanded gap must exceed the ~1.1 s buzz width or adjacent spikes merge into one
onset. Selftest 11 assertions incl. the still-capture / wrong-schedule / gap-perturbation controls.

`nightqc.rtc_drift_summary` + a digest line — main already reads the O2Ring RTC every 10 min (GET_INFO
[24:31]) and logs each event to `_rtclog.csv`, but STATUS kept only the latest and nothing summarised
the night, so the drift and any battery-reset lived in a CSV nobody opened. `summarize` now attaches a
per-ring `rtc` roll-up (reads, drift_s = last−first offset, span_h, resets = battery events, pushes) and
`qc_digest` appends e.g. `O2Ring 98% (RTC +2.4s)` — or `(RTC -151s/1⚠reset)` when a battery event
silently reset the RTC and corrupted the night's stored .dat timebase. This is the one gap in the
otherwise-complete capture-side RTC work; it is NOT a rebuild of it.

Analysis tool + capture-host QC only — no bundle, manifest, or fixture moves.
