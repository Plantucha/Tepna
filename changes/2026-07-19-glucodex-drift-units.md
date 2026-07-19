<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [glucodex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
GlucoDex's "Largest drift" KPI printed the **raw stored mg/dL/day** number under a sub-label naming the **display** unit, so in mmol/L mode it read **18.018×** the "Drift /day" column of the table directly beneath it — a KPI contradicting its own table. The sibling "Between-session spread" tile and the table rows both already routed through `GluDisp`; this was the lone unconverted site.

The two were formatted at **separate call sites**, only one of which converted, so they were free to diverge. Rather than patch the KPI in place, the display-vs-severity split is single-sourced into **`GluDisp.drift(mgdlPerDay) → { display, sev }`**, and both the KPI and `driftSev()` now route through it — the divergence is structurally impossible rather than merely fixed.

The asymmetry that helper encodes is load-bearing: the **value converts**, the **severity stays on raw mg/dL**, because the table rows grade on raw too. Scaling the thresholds to match the converted number — the obvious-looking tidy-up — would fix the number and silently break the colour: a 7.2 mg/dL/day drift the table calls `bad` would render `ok`, since 0.4 < 3. Both directions are pinned by the gate.

9 new assertions in the §RN render-execution harness (the surface that can actually run the converter, rather than a source regex over the KPI's markup). Mutation-verified both ways: reverting the conversion republishes the raw 7.2 in mmol mode; grading the display value instead of the raw flips 7.2 from `bad` to `ok`. Export-inert — **proven**: render/app-only, so `computeHash` did not move and every corpus-backed fixture stayed verified under the current closure.
