<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [Integrator]
brief: INTEGRATOR-POOLED-CLOCK-APPLY-2026-08-01-BRIEF.md
---
Apply the pooled clock fit the Integrator already computed instead of gating it behind a weaker detector.

fitClockOffsetPooled only ran for nodes the coarse pairwise detector had already declared skewed, and
even then only to report a refinement — the applied shift came from the coarse 30 s grid. Measured on
the 24 trio nights carrying CPAP EDFs, the coarse detector produced a finding on 1 while the pooled fit
was confident on 19 and in the documented 30-50 min band on 24. The veto was not minPeakOverFloor (those
nights score 5-12 against a bar of 4) but the all-partners-must-agree clause, which lets ECGDex — which
cannot witness a respiratory event — discard the night. The fit now runs for every dated node and
supplies the applied, sub-second offset; attribution uses the documented physical asymmetry (only an
un-disciplined clock is corrected) after two statistical rules were measured to mis-attribute. Result:
19/24 corrected, all in band, zero mis-attributions. clockSkewApplied now carries source/z/pValue/spreadSec.
