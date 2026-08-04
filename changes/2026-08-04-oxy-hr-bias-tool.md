---
bump: minor
type: added
nodes: []
brief: R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md
---

`tools/oxy-hr-bias.mjs` runs the two measurements that separate R5's three candidate causes for
OxyDex's systematic HR under-read. Candidate (a), OxyDex's own pulse-oximetry HR path, is eliminated:
across 42 nights the raw `Pulse Rate` column mean and `stats.meanHr` differ by −0.0138 bpm, all of it
1-decimal output rounding. Candidate (b), 1 Hz integer bucketing, is real — 0 non-integer values in 42
nights — but cannot account for the size: quantization by truncation predicts a −0.500 bpm epoch-mean
offset and averaging does not wash it out, while the measured offset against the raw-ECG leg is −0.269
bpm (n=3136 epochs, 40 nights, SEM 0.024, 11σ). So a genuine device offset survives, bounded at ≈+0.23
if the ring truncates or ≈−0.27 if it rounds; separating those needs the independent fourth corner the
brief already asks for.
