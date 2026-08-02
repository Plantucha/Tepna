<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: []
brief: O2RING-SYNTHESISED-AXIS-2026-08-02-BRIEF.md
---
`WEARABLE-DRIFT-DIRECT` found the O2Ring swinging **−2282 … +141 ppm** while both Polars held a few ppm, called it "not a clock", and left the mechanism open. Erratic-but-sometimes-perfect isn't what a bad crystal looks like — a bad crystal is *consistently* bad.

**From the raw bytes:** both Polars start `sensor timestamp` at a device epoch ≈ 8.385×10¹⁷ ns. **The ring starts at 0**, because the axis is constructed at capture time — `O2PPG_NS_STEP = int(1e9 / O2PPG_FS_DEFAULT)`, `O2PPG_FS_DEFAULT = 125.738`. Across 60 k consecutive samples it uses only **46 distinct increments**, every one an exact reciprocal of a chosen rate. A crystal does not emit four discrete periods.

So its "ppm vs host" is **the error in the assumed rate**. Two long fragments, one night: 98.1 % at 128.024 Hz reads **+91.8 ppm**; 100 % at the hard-coded 125.738 reads **+783.4**. That implies a true delivery rate ≈ **125.836 Hz** — which `CAPTURE-HOST-DEEP-AUDIT` §145 had already reached from the other side without connecting it to the ppm.

One cause for all of it: erratic across fragments, sometimes near-perfect, night-dependent, and unfixable by a longer span.

**Retracts every closure/TCH result involving the ring leg** — two of three pairs in `CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.3/§2.6 compared a real crystal against a drawing. The −2.2 ppm closure is now best read as coincidence, and the TCH degeneracy needs no correlated-physiology explanation. Polar↔Polar is untouched.

**And it settles why `hostAxis` must not copy `dual-clock-rate`'s span gate.** That gate exists for **leverage**: host timestamps are non-monotonic (2,948 backward steps, max 287 ms measured), so one 470 ms endpoint slip is 712 ppm over 11 min and 21 ppm over 373. `hostAxis` fits many anchors rather than two endpoints, its exclusion cost is the whole fragment rather than one estimate, and its residual error is self-limiting at span × rate-error. The ring's problem is **provenance**, where no span helps — so gate on provenance: **first `sensor timestamp` == 0 ⇒ drawn axis**.

Guardrail: do not re-calibrate the constant. A better constant makes the drawn axis more plausible without making it a measurement.
