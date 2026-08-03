<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [CPAPDex]
brief: MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md
---
A missing CSL lane no longer reads as a periodic-breathing-free night — `periodicBreathingPct` guards on channel presence rather than on its own denominator, and unscored sessions leave that denominator instead of diluting it.
