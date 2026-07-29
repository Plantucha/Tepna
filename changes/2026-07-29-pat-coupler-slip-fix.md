<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md
---
The PAT coupler was pairing an R-peak with the **next beat's** foot whenever a foot was missing, and the go/no-go gate that governs whether PAT ever ships was rejecting it on the resulting artifact.

`coupledPAT` accepted the first foot with `lag >= 0` inside a **2000 ms** search span, while declaring a 200–650 ms physiological window that only ever fed a display diagnostic (`inPhysPct`). **2000 ms exceeds one RR interval** (~1200 ms at 50 bpm), so a detection dropout or motion-rejected beat let the following foot be accepted as this beat's PAT — shifting the reported value by a whole cardiac cycle.

## How it was caught

Running Phase 0 of `INTEGRATOR-PAT-VASCULAR` over 24 pairings on two corpora produced a combination that cannot all be true:

| | |
|---|---|
| `driftRange` | 900–1250 ms |
| `residIQR` | 8–45 ms |
| drift ÷ median RR | **0.85–0.98** |
| per-bin medians | **bimodal, exactly one RR apart** (12/24 pairings) |

2026-07-19 wrist is the clearest: **87 % coupling, 8.0 ms beat-to-beat IQR, 1058 ms "drift"**. A night with 8 ms of local scatter cannot have a second of genuine clock wander. The "inter-device drift" was beat-slip.

## The fix

Extracted to `pat-align.js` as **`coupleRtoFoot`** with the physiological window **enforced** in the pairing, not merely reported. Because `PHYS_HI` (650 ms) is less than one RR, slip becomes structurally impossible: a beat whose foot is genuinely absent now contributes **nothing** rather than a wrong value, and `matchRate` reports real coupling instead of a trivially high number. The worker keeps its contract; the maths is now shared, reachable and gated.

## Why it survived in production — worth keeping

The IQR **does not move at all** under slip: ten slipped beats in sixty cannot shift a quartile. So `residIQR` sat at a healthy 8–45 ms while `driftRange` blew up on the very same nights, and the two metrics were read side by side. A robust statistic hid the defect from the metric next to it. The gate pins this explicitly (`MUTATION · …while the IQR does not move`) so the asymmetry is documented rather than rediscovered.

## Coverage

16 assertions: a clean night pairs every beat at the planted PAT with zero spread; a night with 10 feet removed **drops** those beats instead of mis-pairing them, leaving the surviving PATs and the spread unchanged; no accepted PAT leaves the window; sub-physiological lags are rejected; refusal is explicit and counted. Plus a **mutation control** that re-opens the window past one RR and demonstrates the slip returning — slipped beats land at exactly `RR + PAT` and the range inflates by ~1 RR while the IQR stays at 0.

## What this does NOT do

It does not make PAT feasible. Phase 0's verdict is **NO-GO on coupling** (15–27 % against a 55 % bar), `driftRange` is not a drift estimator in either configuration, and single-host capture turns out **indistinguishable** from phone-stamped capture once slip is removed — refuting the premise that the blocker had moved. `INTEGRATOR-PAT-VASCULAR` stays `PROPOSED` with the numbers inline, and **no Vascular panel is built**, per its own kill criterion. `PAT-FEASIBILITY`'s recorded "~1147 ms of crystal drift" is annotated as a corrected *cause* — 1147 ms is one RR — with its measurement left standing.

`run-tests.mjs` **4331 green, 0 skipped** against the real corpus, `tsc` clean, `build --check` clean (11 owned). No bundle carries the coupler, so no re-bundle.
