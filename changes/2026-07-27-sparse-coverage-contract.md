<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [HRVDex, Integrator]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
A record can now declare `recording.coverage` — the intervals it actually recorded — instead of a single span. HRVDex declared no duration key the Integrator reads, so its window collapsed to a point at t0Ms: a 29-day export overlapped nothing, rendered "Excluded (no temporal overlap)" and dragged the fold's surfaced intersectionMin to 0 for every other node. Stamping `durSec = lastTMs - firstTMs` would have declared 29 CONTINUOUS DAYS of recording for what is a handful of spot measurements, which is why the audit's verifier rejected that fix. The new block keeps `spanSec` (the envelope) and `recordedSec` (the coverage) as separate fields so neither can be read as the other, and the Integrator judges overlap on SEGMENTS via `segmentsOverlap` — two records whose envelopes overlap entirely can still share no recorded minute. `recordedSec` is null rather than 0 when no row states its own length, because "no row said how long it recorded" is not "nothing was recorded". Additive and back-compat: a continuous node emits no coverage block and is judged exactly as before, and the shape generalises to GlucoDex (§3.6) with `kind: 'continuous'`.
