<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: WEARABLE-SYNC-APPLIED-2026-07-31-BRIEF.md
---
Applies the measured H10↔Verity offsets (33 of 37 nights, 27 of them >1 s) to every cross-device figure that assumed the wearables shared a timeline, and restates the results.

**Survives:** the `autonomic_surge ↔ movement_onset` bimodality — 29 nights, **zero sign flips**, both modes shifting by the offset so their separation is invariant (39 s → 38 s). Previously checked on 7 nights; now on 29.

**Withdrawn:** the ordered latency ladder of `CROSS-DEVICE-CLOCK-SKEW` §2d. Re-measured per channel with a null, only 3 channels reach 5 confident nights, their medians span 16 s and their IQRs are ±20 s and overlap completely — and `desat_event`, the rung the story rested on, never reaches 5 confident nights. The ladder was built from point estimates with no uncertainty; it does not survive its own error bars.

**Unbridgeable:** no impulse type connects the O2Ring to a Polar, so its clock offset cannot be measured by this method. Every OxyDex-derived timing figure carries that unknown, stated explicitly rather than left implicit.

Docs only — no code, no bundle, no fixture.
