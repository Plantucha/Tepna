<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [hrvdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
DEEP-AUDIT-VI F5 — a derived DISPERSION statistic is not an RR interval, and routing one through the
RR unit guard inverted rendered clinical verdicts. `DexUnits.asSecondsRR`'s threshold (10) is
calibrated for RR magnitudes (300–2000 ms); rMSSD and MxDMn are dispersions whose clinically real
range CROSSES it, so rMSSD 8 ms (severe autonomic dysfunction) classified as SECONDS, ×1000,
inflated CVI by +3 log units and rendered GREEN (audit repro: d_cvi 6.85 'good', truth 3.85 'bad';
+2.996 discontinuity between rMSSD 10.0 and 9.9 ms). Siblings: MxDMn < 10 ms made d_csi 1000× high
(verdict inverted, NO flag) and d_si 1000× low (extreme stress read 'ok').

- New `DexUnits.asSecondsDispersion` (threshold 0.5, plausibility band [0.0005, 0.5] s): the
  boundary moves out of the clinical domain (between 0.5 ms and 500 ms of dispersion, neither
  physiologic). `guardBaevsky` reads Mode through the RR guard (it IS an RR magnitude) and MxDMn
  through the dispersion guard. CVI is continuous across the old boundary (Δ ≈ 0.004, was 2.996).
- The flags are SURFACED and finally carry signal: `d_cvi_flagged` + `d_csi_flagged` (mirroring
  `d_si_flagged`). Under the RR band a CORRECT 38 ms → 0.038 s always flagged — flagged≈always is
  why the call site discarded it; under the dispersion band 8 ms does NOT flag (it is real) and
  700 ms does.
- Derived-column pin updated deliberately 62 → 64; EXPECT_EXACT rows added. New test group proven
  from BOTH sides (main's code: 17 red legs; fixed: 9/9), driving the same computeDerived seam as
  the existing known-answer groups.

Export-inert proven by re-run: all 3 HRVDex fixtures content-unchanged (the d_* derived layer is
not on the node-export surface). HRVDex + both orchestrators re-bundled (quantity.js inlines into
exactly those three); analysis tools all-current.
