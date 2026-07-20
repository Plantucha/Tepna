<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [HRVDex, PulseDex, Integrator]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Thread the Clock Contract §3 DMY file-lock through HRVDex, PulseDex and the Integrator. All three
passed a bare `{preferDMY:true}`, which is a preference, not the lock: it only breaks genuinely
ambiguous rows, so an unambiguous row (day > 12) still decided for itself and the date order could
flip mid-file — the shape that once shipped an O2Ring night as durationMin = -254460 with ODI-4 =
0/h. Each site now resolves the order once up front via `DexClock.resolveDMY` and passes
`dmyLocked`, matching the pattern oxydex-dsp.js already used.
