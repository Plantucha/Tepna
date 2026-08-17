<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---

SpO2 from the raw 0x05 pair is CLOSED, both routes, by measurement - and the brief's §5.4 stops
saying the opposite.

§5.4 still read "OxyDex SpO2 derivation - UNBLOCKED", resting on a ~1-point ratio-of-ratios agreement
at one saturation. §1.3 had already removed its foundation (no cardiac AC -> no ratio-of-ratios; the
agreement was the one-saturation coincidence the brief itself warns about), but the item was never
updated - the same stale-forward-section hazard as dead-ends §2.7, inside this brief's own §5.

The DC fallback was then measured rather than left as a hope: ln(ch0/ch1), worn-masked with the
contact detector's frozen thresholds, 30-s smoothed, lag-scanned, against a 20-min-shifted null, on
the four most desat-rich PPG2W-paired sessions (SpO2 spans up to 73-99):

    2026-08-13  1.2h  73-99   r = -0.358   null  0.033
    2026-08-12  8.0h  84-99   r = +0.118   null  0.180
    2026-08-11  6.9h  90-99   r = -0.024   null -0.060
    2026-08-14  6.7h  91-99   r = +0.012   null -0.041

THE SIGN FLIPS ACROSS NIGHTS and three of four sit at or below their own null. A physiological
DC-ratio tracker cannot change sign session to session; the one substantial |r| is a single short
unreproduced session consistent with vasomotor/posture co-trending (the stream is Mayer-band
dominated). No usable SpO2 information exists at DC level.

What remains true, stated in the brief: the ring's own SpO2 is the only SpO2 this device yields; the
raw pair now guards its QUALITY instead (ppg2w_contact, #1439); and the only thing that would reopen
the item is an undocumented opcode carrying the second wavelength's CARDIAC waveform - a speculative
hardware probe, named as such.
