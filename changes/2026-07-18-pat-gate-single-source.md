<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
Single-source the PAT promotion gate into `pat-gate.js` and stop discarding the ACC-corrected verdict. The gate (drift ≤ 60 ms · coupling ≥ 55 % · beat IQR ≤ 60 ms) lived as bare literals inside a Web Worker plus five more literals in the renderer, with **no test executing the math**. Extracting it surfaced two undocumented divergences, both now named and gated: a fourth `physical` condition (median lag must be 60–700 ms), and the fact that `verdict()` runs on **uncorrected** drift while the ACC-corrected coupling was computed, rendered, and never re-gated — so an ACC-corrected pass still reported `DRIFT-DOMINATED`. The primary verdict is deliberately unchanged (promoting on corrected drift is an owner call); the worker now also publishes `vdCorr` and tags `driftSource`. 17 new assertions incl. inclusive-boundary pins and the real 2026-07-06 night.
