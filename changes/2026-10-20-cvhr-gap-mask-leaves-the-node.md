---
bump: patch
type: fixed
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

The gap mask PpgDex's CVHR detector runs on now leaves the node. `analyze` published
`quality.nGapSpanIntervals`, a count, and kept the mask itself internal, so a consumer
recomputing the detector rebuilt the time-gap half from the beat axis and could not recover
the bridged half at all — it scored a different detector than the one that shipped the
numbers. The mask ships as `[first, n]` run lengths over the `nn` index space, on the
analyze result and in the rich export's `timeseries.ppi` beside the series it indexes, with
`PPGDSP.maskFromRuns(runs, n)` as the decoder.

Measured on a planted twin: a 95 ms hole — twelve absent rows at 125.7 Hz, against the
node's two-sample rule — invalidates one interval and costs one CVHR event, and the beat
axis stays gap-free, so a consumer rebuilding the mask from `tSec` counts 9 events where the
node published 8. With the published runs the same consumer reproduces 8 from the export
alone.

Three of the six PpgDex fixtures are rich and all three moved by exactly
`timeseries.ppi.spansGapRuns: undefined -> []`; the one fixture that has a gap is not rich,
so the committed set pins only the empty case. `tools/cvhr-edge-widen.mjs` reads the
published mask and keeps the old reconstruction as `--rebuilt-mask`, a control rather than a
deleted path, and reports which source each stream used.
