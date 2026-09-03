<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [cpapdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
A CPAP session set that lost its PLD file no longer publishes `usageHours 0.000` (DEEP-AUDIT-VI F8).

`buildSessionFromEdf` read the therapy clock from PLD || BRP || SA2 but every pressure-derived number
from PLD alone, so a set without PLD reported a measured-looking zero on the session table, in the node
export and under every event index, plus `maskOnLatency NaN`. Measured on real night 20260613_045505:
full set 0.683 h · PLD removed 0.000 h · the same set's BRP `Press.40ms` mask-on fraction 1.000.

Fix, three states: (1) PLD present — unchanged, byte-identical exports (`regen-cpap-goldens`: 0
moved). (2) PLD absent, BRP `Press` present — the BRP lane, block-mean decimated to the 0.5 Hz PLD
cadence, supplies the MASK-ON MASK ONLY: usage 0.683 h and mask-on latency, marked `pressureSource:
'BRP'`. It does NOT feed the pressure statistics — mask pressure is not set pressure (median 4.57 vs
PLD's 6.71 on that night), so medianPressure/p95/mode stay unmeasured. (3) no pressure lane at all —
`usageHours: null` + `usageReason: 'no-pressure-channel'`, latency null, every index null. At night
level one unknown session makes the total a lower bound, so the night's usage is null with
`usageUnknownSessions`, and that session's events leave the indices WITH its hours (counting them over
the other sessions' hours read 48/h against 24/h).

Gate: new `CPAPDex F8` group, 22 assertions, pair-verified red on `origin/main`'s `cpapdex-dsp.js`.
CPAPDex 41cbfb0dd92b → 9da7f9eb7aa8; orchestrators + 4 analysis tools re-bundled.
