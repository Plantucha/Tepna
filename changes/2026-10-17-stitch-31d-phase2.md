---
type: fixed
bump: patch
---

Add the 31-day stitch pipeline: stitcher, daemon hook, and server-side runner.

The stitcher concatenates the last 31 solid nights per fused tool into
/srv/tepna/stitched/<tool>/, with null gap markers for absent nights
(never zero-filled). Each tool also gets SIDECARS.json with per-night clock
offsets and wear intervals for timebase alignment.

The daemon hook in qc_child fires the stitcher when a PASS verdict lands;
the hook records a stitch failure, never raises it, so the verdict stands.

The Node runner executes the trio engine server-side during quiet hours
(refuses when capture is active unless --force). It computes per night, where
the three devices stay co-located, then aggregates across nights: median sigma
per device with a bootstrap 95 percent CI. A 31-day concatenated series with
30 inter-night gaps breaks the hat's co-location assumption, so the engine
never sees the stitched series. Gap nights stay absent from the aggregation,
never zero-filled.
