---
bump: patch
type: fixed
brief: none
---

A resumed seam sidecar now examines the reconnect boundary — the one interval a clock seam can
occupy, and the one interval it never judged. `_SeamSidecar` started every instance with
`_prev_ns = None`, so session 2's first interval was stored, not examined; on the owner's 2026-09-21
H10 night the device clock stepped +243,739,222 s at exactly that row, and ECGSEAMS.txt carried 178
`# final … seams=0` lines and 0 seam rows. The writer now hands the last complete row's
(sensor_ns, phone_ms) to the sidecar it resumes, so the first feed judges the boundary and
`examined` counts it. An absent, torn or clockless last row hands over nothing (§∅), never a zero.
Plant: the real row pair; control: the unseeded sidecar prints seams=0 on the same samples.
