<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
`--scan` — ask whether there is ANY constant offset at which a window couples, which is what §3f.4 says separates the two explanations for the intermittency.

§3f found strict coupling on 20/57 windows with the **median window at exactly its chance floor**. Physiology coming and going, and the residual offset wandering in and out of `[200, 650]` ms, both predict that shape. The scan separates them: sweep a constant δ, take the max, and — because a max is a selection — **take the null's max the same way**, scanning every circular-shift surrogate over the identical δ grid. Whatever advantage scanning grants the observation it grants the null identically.

**Two limits on `bestOffsetMs`, both found the hard way and both now documented and gated:**

1. **Only defined mod one RR.** A beat train is periodic, so δ and δ ± RR are indistinguishable — the `beat-trains-align-only-mod-rr` constraint. Raw `bestOffsetMs` therefore appears to "jump" by ~one RR between windows when it may only be aliasing. The reduction and the median RR are both published so it is checkable rather than assumed.
2. **And weaker still: the argmax sits on a PLATEAU ~450 ms wide.** Any δ keeping the lag inside `[PHYS_LO, PHYS_HI]` scores identically. Found by a gate assertion that expected ~0 on planted data and got −200 — the code being right and the assertion wrong. So `bestOffsetMs` *bounds* the offset to a 450 ms band mod RR; it does not estimate it, and two windows differing by less than that band are **not** evidence the offset moved.

**A defect the smoke run exposed:** the scan initially reused a divided-down surrogate count (`max(8, n/3)`), which floors its p at `1/(n+1)` — every window reported exactly **0.111** and the statistic could not have come out any other way. It now takes its own `--scan-surrogates`, defaulting to the main count, and the gate asserts the p cannot beat its own floor.

Gated in the Node lane: the scan finds planted coupling, puts the lag inside the physiological window, publishes a checkable mod-RR reduction, and cannot report a p below its floor.
