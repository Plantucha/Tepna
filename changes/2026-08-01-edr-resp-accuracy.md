<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md
---
Stop `crc.respFromEDR` reporting half the true rate at 24 breaths/min — a harmonic check plus parabolic peak interpolation on the EDR autocorrelation.

`patch`: a surfaced value becomes more accurate; no field changes shape. 24/min went from 12 (-50 %) to
23.6 (-2.5 %) and the 4 Hz lag quantisation is gone. The 8-12/min over-read is a third mechanism (low
band edge) and is deliberately untouched — it needs a steeper filter, which moves every CRC metric.
