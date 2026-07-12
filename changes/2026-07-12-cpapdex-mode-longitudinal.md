<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [CPAPDex, suite]
brief: CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md
---
Retire the per-night CPAP/APAP label — a device *setting* is not a per-night fact. And retract §M1's coupling magnitude: the null model was broken.

Both findings come from driving all **182 real nights** through the node, which is the first time either
question was answered with data rather than reasoning.

**§1 — `mode` was the wrong SHAPE, not merely the wrong constant.** P4 fixed a real bug (the old cut was
measuring EPR, not auto-titration) but kept the per-night label. The corpus says that was still wrong, in
the plainest possible way — the *same* envelope statistic, judged two ways:

| estimator | label flips across 182 nights |
|---|---|
| old bare-IQR cut | **41** |
| P4's per-night envelope + session stability guard | **7** |
| rolling 7-night median of the same envelope | **0** |

The device did not change 7 times. `mode` describes a device **setting**, which does not vary nightly, so
a per-night estimator has no per-night signal to find — it can only measure nightly noise in a quantity
that is constant by construction. P4's stability guard could never have rescued it: it pooled *sessions
within* a night when the quantity is stable *across* nights. It guarded the wrong axis.

So the per-night label is **retired** (`metrics.mode` is always `null`; the field stays, so the export
contract holds) and the call moves to `buildLongitudinal()` — `mode` / `modeEnvIqr` / `modeNights`,
requiring ≥7 nights. On the corpus: **APAP @ 1.33 cmH₂O over 180 nights, 0 flips.** A single night reports
`pressureEnvIqr` (a measurement) and names no device setting; the pressure card drops its mode chip.

**The calibration this was supposed to do is impossible, and that is the honest headline.** The
`pressureEnvIqr` distribution is **unimodal** (median 1.33, continuous 0.11–3.83, **no valley**) because
the corpus contains **no fixed-CPAP nights at all** — one machine, one mode. A boundary between two
classes cannot be fitted to data containing only one of them, so the CPAP/APAP cut is currently
**unfalsifiable**. What is now established is that the call is *stable* (0 flips) and no longer reads EPR.
Labelled as such in the code.

**§2 — `tools/cpap-oxy-couple.mjs` now imports `event-coupling.js`** instead of carrying its own copy
(prototype deleted, so it cannot drift from the gated primitive). Re-running it re-derived §M1's numbers —
and **§M1's ×3.3–10 coupling is RETRACTED**. On 44 paired CPAP∩O2Ring nights with a null that now wraps
circularly, **nothing couples above chance**: central (n=733) ×0.5–0.7, obstructive (n=58) ×0.7–1.1,
hypopnea (n=247) ×0.6–1.1. The old figure was the non-wrapping null deflating `chance` and inflating
`lift` — precisely the direction that bug was predicted to bias. §M1's *negative* findings survive intact.

This is a **well-powered null, not a saturation artifact**: `maxLift` is ×14–24, so a coupling up to ×14
could have been seen and was not — the exact distinction `saturated`/`maxLift` exist to make.

⚠️ Recorded as a caveat, not a conclusion: the longest central apneas (>25 s, n=48) show **zero** desats
where chance predicts ~3.4. That is *anti*-coupling, which is physiologically odd; rule out an
inter-device clock offset, the oximeter not being worn, or a detector morphology miss before anyone
publishes it.

CPAPDex re-bundled; 2 fixtures regenerated (`metrics.mode: "APAP" → null`). `contentId` unchanged —
session-level `mode` is retained as the raw input the longitudinal call pools.
