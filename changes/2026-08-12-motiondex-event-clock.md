<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [MotionDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
MotionDex's exported `ganglior_events[].t` is pinned to the UTC wall clock — the §6 cross-node currency.

`motiondex-dsp.js` writes `fmtClock(seg.tStartMs)` straight into that field and is the ONLY node in the
fleet that puts a formatted clock string there. §6 makes `t` a wall-clock string with no date, which
consumers recombine with `startEpochMs`'s date, rolling past midnight — so a formatter reading local
getters does not mis-render a label, it hands every downstream consumer a wrong instant to reconstruct
from, in the fleet's shared currency. That is the Integrator's input.

MotionDex's formatter is module-private, so the sibling §5 group cannot reach it; this drives the real
export path through `buildNodeExport`. Covers the midnight wrap, and the `tStartMs: null` segment that
must export `t: null` rather than a fabricated stamp.

⚠️ THE SECONDS FIELD NEEDED ITS OWN TIMEZONE. Every IANA offset since 1972 is a whole number of minutes,
so `getSeconds()` and `getUTCSeconds()` agree under every modern zone and a `getUTCSeconds -> getSeconds`
mutant SURVIVES the Kolkata check — measured, and predicted before it was measured. It is not equivalent:
JS still models pre-1972 local mean time, and Africa/Monrovia ran at -00:44:30 until 1972, so a 1960
instant reads :45 locally against :15 UTC. Filing it as equivalent without looking would have recorded a
killable defect as unkillable.

Verified by applying four mutants: extreme body -> `return ''`, `getUTCHours -> getHours`,
`getUTCSeconds -> getSeconds`, and dropping the null guard. Each reds the group.
