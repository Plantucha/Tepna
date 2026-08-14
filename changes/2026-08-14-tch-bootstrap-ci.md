---
bump: patch
type: added
brief: CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md
---

`tools/tch-bootstrap-ci.mjs` — the first confidence intervals for the three-cornered-hat sigmas, which
this suite has been quoting as bare numbers.

Moving-block bootstrap (seeded, 2000 replicates, block L=5 epochs, 38 nights). Blocks rather than
i.i.d. for the reason §5 established: consecutive epochs share posture, perfusion and wander, so
single-epoch resampling destroys the dependence and returns intervals that are too narrow.

    ECGDex   0.352   95 % CI [0.290, 0.406]
    PpgDex   0.261   95 % CI [0.170, 0.335]
    OxyDex   0.988   95 % CI [0.820, 1.091]

🔴 THE ECG-vs-PPG ORDERING WAS NEVER ESTABLISHED. Differencing the bootstrap medians, only the ring
separates:

    ECGDex − PpgDex   [−0.018, 0.214]   overlapping — NOT resolved
    ECGDex − OxyDex   [−0.740, −0.445]  separated
    PpgDex − OxyDex   [−0.885, −0.530]  separated

The chest-ECG-vs-armband-PPG comparison, quoted repeatedly as "ECGDex 0.30, PpgDex 0.33" (PPG
marginally worse), is inside noise — and on this run the point estimates reverse. Nothing should be
concluded from the reversal either; the interval straddles zero, which is the point. Every statement
ranking those two sensors has been over-reading.

⚠️ These medians do not reproduce the quoted 0.30 / 0.33 / 1.10 — different alignment and night set.
Neither supersedes the other; both are suspect as bare numbers. That is the third figure in this brief
to fail re-measurement, which is itself the argument for intervals over points.

🔴 THE INDEPENDENCE ALARM FIRES ON 41.7 % OF REPLICATES — 3003 of 7200 within-night replicates produce a
non-physical negative-variance split, ranging 4 %–81 % per night. A negative split is TCH reporting
that the uncorrelated-error assumption is violated (DA-V F6), so this is §1's identifiability problem
appearing as a measured rate rather than an argument. It is reported beside the estimates rather than
filtered away, because an interval computed only over the physical replicates would conceal it.

This strengthens the case for §2's remaining items (Premoli–Tavella's positive-definite constrained
solve, KLTS intervals): a 41.7 % non-physical rate is the condition those methods exist for. The
bootstrap does not replace them — it measures the size of the problem they address.

No runtime change: `integrator-tch.js` is untouched, no bundle moves, no fixture is affected.
