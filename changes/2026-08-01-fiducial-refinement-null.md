<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF.md
---
`IBI-ALIGNMENT-LIMIT` closed beat-derived alignment but left one escape route open: an aperiodic channel picks the beat, then intervals refine inside it. Measured, and the route is closed too.

That scheme needs the coarse stage inside **half a mean RR (~0.6 s)**. The pooled clock fit resolves to **15 s** median support on this corpus — a **~25× gap**.

Both ways to sharpen the coarse stage were tested against the same 36 nights, changing only which instant a channel stamps, and **neither helps**:

| change | confident | median support |
|---|---|---|
| *as shipped* | **22**/36 | **15.0 s** |
| `autonomic_surge` at its rebound instead of the trough | 21/36 | 15.0 s |
| `desat_event` at `onsetTMs` instead of the nadir | 21/36 | **20.0 s** *(worse)* |

Two distinct reasons. **Pooling absorbs a single channel's offset** — `autonomic_surge` is one of ~12, so a systematic 20 s shift barely moves a statistic built from all of them; that is what pooling is for, and it is why the same fiducial correction that mattered enormously for cross-channel *physiology* (bimodal → unimodal, 1.0 % → 36.1 % coincidence) is invisible to the clock. And **a conceptually sharper instant can be an empirically noisier one** — the desaturation onset is the top of a gradual descent where the nadir is a well-defined extremum, so the fit gets worse.

Sub-second alignment is therefore not reachable by refining fiducials on the channels this suite already emits; it would need a categorically sharper anchor. Recorded so the two-stage idea is not re-proposed on the strength of the sentence it qualifies.
