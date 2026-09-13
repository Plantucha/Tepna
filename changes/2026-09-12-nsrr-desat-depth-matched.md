---
bump: patch
type: fixed
nodes: [oxydex]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

The expert desaturation index is computed at a matched DEPTH threshold, not from the raw event count.

An earlier version of this tool stated that "SHHS scorers marked desaturations at a ≥3 % drop" and
paired their event count against ODI-3 on that basis. That was an assumption and it is false. The
scorers publish `SpO2Baseline` and `SpO2Nadir` on every event; read over 99 records, a **median 70.9 %
of scored desaturations are shallower than 3 %**, the minimum drop being 0.0 %.

A 3 %-threshold detector cannot count a 1 % event, so most of the apparent shortfall was arithmetic.
`SpO2 desaturation` named two different populations — the scorer's and any threshold index — and the
whole comparison rested on the join between them.

Reported against the unfiltered list OxyDex appeared to find 37 % of desaturations. Depth-matched it
finds a median 119 % (ODI-3 vs ≥3 %) and 96.5 % (ODI-4 vs ≥4 %): no systematic under-detection. What
survives is per-record spread — only 31 of 91 records fall within ±25 % of the expert index.

Seven assertions pin the filter, including the 2.9 % edge and the rule that an event without
baseline/nadir is skipped rather than counted as depth 0. The unfiltered index is kept and labelled so
the two can never be silently paired again. Plant-verified: dropping the depth filter reds five.
