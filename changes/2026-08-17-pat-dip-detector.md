---
bump: minor
type: added
brief: PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md
---

`PATAlign.patDipEvents` — the relative ΔPAT estimand: within-connection dips against a centered
rolling-median baseline, with foot-gap shadowing (a missed foot's neighbour pairing fabricates a
±(RR−1000 ms) pseudo-dip — caught by the slip twin, closed at the source), Schmitt-style hysteresis
(one −0.9 Θ noise draw no longer splits a real arousal), and two refusal modes: a noise floor above
2×Θ ("per-beat scatter drowns dip-scale excursions") and quantized fiducials (floor 0.0 ms with a
dominant exactly-zero share — integer-sample feet). Ten adversarial twins in `pat-align · dip-detector`.

`tools/pat-dip-index.mjs` runs it per night over the coupler's own train extraction.

First five real nights (2026-08-13 → 17, pulled from vigil): **every leg refuses, with named
reasons** — finger floors 80–122 ms (the `_PPG.txt` display waveform's 91.8 ms foot sd, compendium
§5.2), ankle quantized at 55 Hz (§8's integer-grid trap). The blocker is fiducial quality, not clocks
and not the estimand; both fixes are already named in the brief. Before this ran it was plausible the
detector would index the noise as arousals — it refuses instead, which is the twins doing their job.
