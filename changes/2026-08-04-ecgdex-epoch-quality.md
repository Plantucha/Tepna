---
bump: minor
type: added
nodes: [ECGDex]
brief: TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md
---

Exports per-epoch signal quality from ECGDex. The node computed per-beat SQI and the epoch's beat count
and threw both away, so a consumer reading a 118 bpm epoch could not tell an artifact burst from a real
tachycardia. Both now ride on the exported 5-minute epoch as `sqi` and `beats`.

Per-beat SQI is carried into `epochEngine` in the same pass that builds nn/tt, which is the file's own
existing idiom and is load-bearing: `peaks[i]`, `nnRes.nn[i]` and `sqi[i]` share an index only before the
confidence filter, so deriving it afterwards would hand a consumer a mask of one length and a series of
another. Both fields are projected at the export seam as well as the internal builder, because ECGDex
builds its epoch twice and a field added only to the first never leaves the node. An absent SQI is null
rather than a defaulted 1, since a fabricated 1 reads as clean.

Measured on 12 real H10 nights (573 exported epochs), sqi spans 0.47 to 0.97 with about 50 distinct
values per night and beats spans 116 to 657. The ten epochs above 100 bpm carry higher sqi than the rest
(0.753 vs 0.554) with beat counts matching their rate, so they are real tachycardia and the fields say so.
Note that beats divided by hr times five is close to 1 in both groups because hr derives from the same
gated NN that beats counts, so that ratio is not an independent artifact check; sqi is the informative
field and beats reports how much data backs the epoch.

Gated by 14 assertions in both lanes with three mutants confirmed to red. `epochEngine` is exposed on
ECGDSP so the null-SQI leg is reachable; the first attempt attached it to ECGDex instead and three legs
skipped silently while the group still read green, so that guard is now an assertion rather than an if.
Only the rich synthetic golden moved; the light exports carry no epochs.
