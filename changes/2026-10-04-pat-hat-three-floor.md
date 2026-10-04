---
bump: minor
type: added
brief: PAT-HAT-RING-FLOOR-2026-10-04-BRIEF.md
nodes: [analysis]
---

The PAT three-cornered hat is solved on three arrival-FLOOR axes instead of raw receive stamps: E11's
`PPG_FRAME` rows give the O2Ring a floor, so the finger leg joins the two Polars and every corner's σ is
free of its device's link buffering.

Two counters exist for the ring's PPG and only one may anchor a floor. `_PPG.txt`'s
`sensor timestamp [ns]` is the HOST-SYNTHESIZED 125.000 Hz grid — gaps inserted from elapsed host time —
so a floor against it would measure its own construction, and the Clock Contract §7 says a drawn axis is
never a clock. The sidecar's `first_sample_idx` is the ring's own cumulative stream position, and that is
what anchors. Feet map to device positions by walking the sidecar's frames rather than by row index,
because an honest gap writes no rows: after the first dropout a row index is no longer a position.

Both PAT pages drop the sentence "the ring has no arrival-floor axis", true until #3267, and show the raw
and three-floor σ sets side by side — never a delta between them, since re-timing changes the axes and a
difference would read as "the smaller number is the better instrument".

⚠️ The plant is a SYNTHETIC frame-arrival sequence and says so: no captured night carries a ring arrival
sidecar yet, because #3267 is daemon code and takes effect only after the box restarts on it. The brief's
evidence line stays open until a real night exists.
