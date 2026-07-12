<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: CPAP-REAL-CORPUS-2026-07-11-BRIEF.md
---
Add `event-coupling.js` — the shuffled-null cross-node event-coupling primitive, the suite's missing "is it real or coincidence?" test.

Two frequent event streams co-occur **by construction**, so a raw co-occurrence rate is not evidence
of anything. On the real ~180-night CPAP corpus a chance baseline **inverted** the naive read: the
*dominant* event class (n=688) sat at lift ×0.6–1.0 — exactly chance — at every window from 0–30 s to
0–120 s, while a *rare* class (n=39) hit ×3.3–10. `coupling(eventsA, eventsB, opts)` measures the
observed rate against **circular time-shift surrogates**, which preserve both streams' marginal rates
and destroy only the alignment.

Generalizes to CPAP apnea × desat, ECG arrhythmia × desat, GlucoDex excursion × anything — the
primitive the Integrator needs before it can claim any cross-node coupling.

Three things it does that the `tools/cpap-oxy-couple.mjs` prototype did not, each a way the naive
version lies in the direction the reader wants to believe:

- **The null now WRAPS.** The prototype shifted additively, so surrogate events fell off the end of the
  recording where no B can ever match them. That deflates chance and therefore **inflates lift** —
  it manufactures couplings. The shift is now circular within the recording span.
- **Saturation is flagged, not silently reported as "no coupling."** If the window is wider than B's
  mean inter-event interval, every A finds a B by chance, and lift is crushed toward 1.0 **by
  arithmetic** even when the coupling is perfect. Each measurement now carries the exact ceiling
  `maxLift = 100/chancePct` and a `saturated` flag, so a lift of 1.0 can only be read as absence on a
  window that could have shown presence.
- **Default shifts are no longer whole minutes.** Round shifts are all multiples of 60 s, so against a
  stream with a round periodicity every surrogate re-lands on the same phase and a real coupling reads
  as ~1.0 — a false negative. Caught by the module's own gate (a planted, perfect coupling scored
  **lift 1.006** under whole-minute shifts); defaults are now second-level and share no factor with
  30/60/120 s.

Duration stratification ships too — §M1's decisive refinement, and what turns "no signal" into
*provably* no signal: a long event must couple if the coupling is real (the corpus's longest bucket,
n=42, came back at ×0.0).

Standalone spine module, dual-realm, **not** co-loaded into any bundle (no app consumes it yet, so
wiring it into `dex-coload.js` would re-bundle all 8 apps to carry inert code — same economics as the
`BADGE_CSS` rule; it rides the first node that uses it). **No `manifestHash` moves; no fixture is
touched.** Gated in both runners: 22 self-test assertions + a 21-assertion contract group.
