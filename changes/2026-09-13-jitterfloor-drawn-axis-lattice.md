<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md
---
`jitterfloor`'s drawn-axis guard missed the O2Ring — the device whose axis is the canonical drawn one.

`_device_axis_is_drawn` tested MODAL concentration ≥ 0.99. The ring's device deltas are exactly
1000/2000/3000/4000 ms — unmistakably `sample_index × an assumed rate` — but dropped frames put ~2 % of
the mass on the multiples, so the modal share was **0.9787 / 0.9725**, under the bar. The guard passed,
`vs-device` ran against a fabricated clock, and the ring reported **499.5 ms** on one adapter and
**11.5 ms** on another from host inter-arrivals that are statistically identical (median 1001 ms both,
84.7 % vs 82.9 % within ±50 ms of 1000). 499.5 is simply half the base interval: the residual is
`host − 0` on the 49.9 % of device deltas that never advance.

⚠️ **The obvious fix is wrong and is documented in place so it is not re-attempted.** Keying on the
share of deltas that are integer MULTIPLES of the modal convicts the honest clocks — Polar H10 `acc`
scores 0.9930 and `ecg` 0.9990 on that test, because a real clock at a fixed frame interval also emits
2×/3× when frames are missed. Being a multiple does not separate the populations; being EXACT does.
The guard now tests the share of positive deltas that are exact integer multiples of the smallest, in
the RAW NANOSECOND field, where the two populations sit six orders of magnitude apart with nothing to
tune: O2Ring `1.000000` on a 1 s grid, every Polar stream `0.000003`–`0.000068`.

∅ An axis that never advances is also not a clock (Verity `ppi`: 100 % zero deltas both arms) and is
now refused deliberately rather than by the coincidence that its modal is 0.0 at 100 % concentration.

**Published figures that move.** Any ring jitter quoted from `vs-device` was computed against the
fabricated axis. Recomputed over 2026-09-11/09-12: Sena **499.5 → 10.5 ms**, Zephyr **11.5 → 11.5 ms**.
The ring therefore shows **no Zephyr advantage** — it slightly favours the Sena — reversing the earlier
reading. Two ring figures circulated to the owner (52.5 ms Sena / 38.0 ms Zephyr, a different window)
come from the same broken path and are retracted; that window was not reproduced here.

🔴 Exposes a SECOND defect, logged not fixed — residue `2026-09-13-folded-base-prefers-the-largest-candidate`.
Routing exactly-drawn axes to `folded` makes `_folded_base`'s base selection reachable for a shape it
mishandles at a ~1/3 drop rate. `test_missed_frames_do_not_inflate_folded_jitter` is now
`xfail(strict=True)` so the marker cannot outlive the bug. Real-corpus impact is small: at the ring's
actual ~2 % drop rate folded returns 10.5/11.5 ms.
