<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---
§3i — reconcile §3g against `INTEGRATOR-PAT-VASCULAR` §2-RESULT-II's offset-free 0/54: the binding constraint is **beat-to-beat scatter, not the offset**. §3g.3 is retracted.

**They agree on the level; only the bar differs.** Their offset-free coupling is 18.8 / 19.2 / 19.0 % within ±100 ms of each night's own modal lag; the best-scan level here is 15–16 % within ±40 ms. Their band is the *more generous* and still yields ~19 %. **§3g's 47/57 means "above a matched null", not "high"** — against the gate's 55 % bar both harnesses say the same thing.

**Their binding number reproduced from a different harness.** IQR of (lag − modal lag) over beats within ±100 ms, at the best-scan offset, 52 windows: **median 84 ms (36–99)** against their **95.6–98.7 ms**, bar 60 ms. Windowing adds one nuance — **10 of 52** windows clear the bar at 60-min granularity against **0 of 54** whole nights — so it helps, and nowhere near enough.

**⚠ A trap in a shipped tool, nearly published as a contradiction.** `pat-matchrate-strict.mjs` builds `residIQR` only from residuals it already accepted, and acceptance is `|d0| ≤ STRICT_W_MS` (40 ms) — so it is bounded by its own window, measures 31–44 ms on all 52 windows regardless of signal, and read against a 60 ms bar reports **52/52 passing**. That is a tautology and the inverse of the truth. The tool built to expose a self-referential statistic carries one on a different field. **Never gate-compare `strictMatchRate.residIQR`**; `scatterIQRms` is added here as the comparable quantity, with the reason recorded at the call site.

**Consequences.** §3g.3's claim that closing offset precision "is the whole remaining problem" is retracted in place: the offset is not the last obstacle, and a perfect one would not move a dispersion measured offset-free by construction. The remaining problem is that the R→foot interval is *stable in its centre and loose in its detail*. Their H10→O2Ring finger leg also already exists (n=11, 19.2 %, `residIQR` 98.7 ms, 0/11), which `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5 treated as open — that scoping was a duplicate too.
