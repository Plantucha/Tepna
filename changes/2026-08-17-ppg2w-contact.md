<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---

The O2Ring's raw 0x05 stream (`_PPG2W.txt`, captured nightly since 2026-08-05, consumed by nothing)
gets its first consumer: `ppg2w_contact` in nightqc - an independent hardware-side worn/off-finger
vote, where today the SpO2 CSV judges itself and the motion column is per-source-faulty.

THE PHYSICS THAT MAKES IT SAFE TO WIRE WITHOUT RESOLVING WHAT 0x05 IS: under every open identity
hypothesis (servo-DC pair / ambient pair / integrator), tissue in the path locks the two channels to a
~1:1 ratio. Off-finger they diverge by FOUR ORDERS OF MAGNITUDE - ch0 rails toward its ceiling while
ch1 collapses to ~10^2 counts.

EVERY CONSTANT LABELLED MEASURED vs CHOSEN (the four constraints the Vigil box session set):
- PPG2W_CH1_FLOOR = 15388: MEASURED - geometric midpoint of the doffed-tail ch1 p99 max (355, n=3)
  and the worn ch1 p1 min (667,065, 15 sessions); ~43x margin each side (3.3 orders of TOTAL separation); wrong iff a
  firmware/scale change moves either population by >~40x.
- RATIO [0.5, 3]: CHOSEN - a ~2x margin around the MEASURED worn band (0.955-1.444). The margin
  earned its keep out-of-sample: a held-out 7-min adjustment session reached 1.929 and stayed inside.

VALIDATION WITH DENOMINATORS BESIDE RATES: derivation (08-05..09, 15 sessions) separates the 3
mid-stream doffings from 12 other tails - in-sample by construction. HELD-OUT (08-11..16, 14 sessions,
161,811 one-second epochs, thresholds frozen FIRST): worn band held on every session, 0.49 % off
epochs concentrated in 0-1 sustained runs, 6 doffing tails found out-of-sample. Positives total n=9.

REFUSES, NEVER FABRICATES: under 60 s -> {usable:false, reason}; no stream -> []; an all-off session
-> worn band ABSENT (null), not fabricated from off rows; doff_at only when the tail genuinely ends
off-finger. Reported, gated by nothing (the arrival-diagnostics precedent) - a contact verdict folded
into `ok` would make a night the wearer ended early read as a capture failure.

TWO DEFINITIONS THE TESTS CORRECTED BEFORE SHIPPING: "ended off-finger" was first majority-of-last-
minute, and the planted 30/60 case landed exactly on the window's tie - redefined as a sustained
(>=10 s) trailing off-run, which is what a doffing IS. And the parser skips non-numeric rows: a
mid-file repeated header is a real rotation artifact (seen 20260815100132), and a torn row must not
erase a session's verdict.

THE 100 % BRANCH FLOOR EARNED ITS KEEP AGAIN: it flagged the run-CLOSING branch (an off-run that ends
mid-session - the wearer adjusted the ring and put it back), which no planted case exercised and which
is exactly the case that must count as a sustained run but NOT a doffing.

capture-host lane: ruff clean, 3894 tests, 100.00 % statement+branch. Real-night check: the wired code
reproduces the validation exactly - one doff block on 2026-08-09, doff_at 07:02:22, 117-epoch trailing
run. Coordinated end-to-end with the Vigil box session, whose lane this is.
