<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PpgDex, docs]
brief: none
---
**The committed trio corpus is re-folded under the per-segment host axis, and the published
three-cornered-hat table is re-derived over the SAME 90 nights.** Every `.trio-stamp` was stale — 89
nights at `7fb220f140806c93` (82) or `5539f481b04cc507` (7) against today's closure
`23ce26ba72921405`; 93 nights re-folded from `/srv/data/tepna-corpus`, PASS, 1845 s, `--jobs` not
forced.

**Control first, on a stepless ring night:** 2026-08-03 is the only committed ring night whose
published axis is both stepless and in-band (`maxStepMs` 303.85 ms, `ppm` 13.87) — all five exports
byte-identical volatile-stripped with only `.trio-stamp.codeDigest` moving. At corpus scale the same
holds for **111 of 147** re-folded nights, and `ECGDex`/`OxyDex` are identical on every stamped
night, which measures the rest of the compute closure as output-inert across the two generations
instead of assuming it.

**36 nights moved; 32 move in the PPG path only.** The worst committed seam, 2026-09-21, published
`hostAxis.ppm +4170.55` for a crystal with a **7.37-hour** `maxStepMs` inside ONE axis; re-folded it
reads 13 anchors, −279.53 ppm, `maxStepMs` 1.47 ms, and eight `ganglior_events` timestamps move by up
to 7.4 h (`recording.startEpochMs` does not move). 26 committed ring exports carried a `maxStepMs`
over 10 s and 35 published `|ppm| > 50`.

**§11 re-derived over the same 90 nights and the same 658 tracked files** (digest `a8f64980ac85` →
`6f6b14e7bcd4`), so the movement is the fold rather than the population: h10 +2.1 %, o2 +0.9 %,
verity **−44.7 %**; between-night shares 0.393 / 0.273 / 0.176 % stay inside the recorded
0.19–0.46 %; identity holds to 1.2e-15. The superseded 09-29 `TABLE-PROVENANCE` stamp is **demoted**
from clearable to recorded-only rather than re-stamped — writing the new digest onto the old table
would claim those numbers came from a corpus they were never cut from.

The H10↔Verity within-night term rose 17.2 % and that is **not** explained here — residue
`2026-10-03-verity-ppg-moves-in-a-ring-seam-refold`.
