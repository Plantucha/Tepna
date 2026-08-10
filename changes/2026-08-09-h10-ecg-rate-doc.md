<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs, capture-host]
brief: H10-ECG-RATE-CORPUS-CHECK-2026-08-04-BRIEF.md
---
State the H10's measured ECG rate (129.9938 Hz, −47 ppm) instead of "exactly 130.0000", which was our own nominal read back.

Documentation only — no constant, threshold or decoder behaviour changes. `polar_pmd.py`'s back-timing
comment, `PMD-DECODE-SCALE-AND-RATE` §77 and §140 now carry the measured figure with its ppm and the
reason the old one was circular (that segment predates `80e05501`, so 98.63 % of its deltas were
`1e9/130` exactly — `DEVICE-RATE-TRUTH` §4.1). `O2RING-SYNTHESISED-AXIS` §3 gains a ⛔ subsection with
a side-by-side discriminator table so the drawn-axis finding is not extended to the H10, which passes
that test by 44 points.

Two of the executing brief's own numbers were corrected against a re-measurement of the same 50-file
PSL corpus: the ppm **sign** (a step +364 ns long is a rate of −47 ppm, not +47) and §3's
discriminator pair, which was one uncapped file rather than the corpus (660 median distinct deltas /
26.70 % modal share, worst case 55.38 %). The §2 rate figures reproduce to the digit.
