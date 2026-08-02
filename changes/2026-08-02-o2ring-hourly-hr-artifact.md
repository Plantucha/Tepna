---
bump: patch
type: fixed
brief: O2RING-HOURLY-HR-ARTIFACT-2026-08-02-BRIEF.md
---

Stop deleting genuine arousals that happen near a clock hour. OxyDex rejected the O2Ring's
vendor-confirmed hourly HR artifact twice: once at sample level (`cleanArtifactHR`, which already
worked) and again at spike level by dropping every spike within ±2 min of a clock hour. Measured across
37 O2Ring nights, that second rule missed 1 of 44 artifacts and deleted 11 of 35 genuine arousals — 31 %
— because ±4 minutes of every hour is 6.7 % of the night.

The criterion is now the onset rate: a heart cannot gain 20 BPM in one second, an oximeter
double-counting cycles can. Post-firmware-fix nights (the control) top out at 7 BPM/s across 13 spikes,
so a 15 BPM/s bar has better than 2× headroom and rejects nothing genuine. Clock alignment is still
computed and reported as `stats.artifactSpikesClockAligned`, but as evidence, never the criterion.

No export byte moves — the diagnostics stay inside the detector, so committed fixtures reproduce
exactly. The artifact affected nights 2026-05-03 → 2026-05-27 only; no fixture or corpus night is in
that window.
