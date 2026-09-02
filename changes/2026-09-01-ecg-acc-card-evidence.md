<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
The ACC Cross-Check card badges every number it surfaces — and the grade behind the badge is now a
measurement rather than an inheritance (DEEP-AUDIT-VI F4).

**The defect as found:** 'ACC breathing N br/min', 'ECG/EDR breathing N', the Δ chip and the posture
%-pills reached the eye with no evidence badge, while `ECG_REGISTRY` graded all of them. Invisible to
every existing gate, because `no-fabricated-tier` scans `evBadge` CALL SITES and there were none to
scan — the absence of a call site is the one thing a call-site scan cannot see.

**What checking the grade turned up.** Two entries carried `dormant: true`, which asserts "no compute
site exists, so the metric reaches no export and no surface". Both were false: `rraccRate` is computed
by `accExtras` and surfaced by `_accCardRR`, `edrDisagree` is surfaced by `_accCardAgreement` and
exported as `disagreementRatePct` — since the initial commit (2026-07-01), while the flag arrived
2026-08-18 claiming a sweep had "confirmed per-name — id, label and every alias". Wrong on day one,
not stale. A new fleet gate (`badges · registry · dormant-surface`) now asks the one question the flag
makes, with a negative control proving it catches this case.

**The re-adjudication the flag's own contract requires — measured, and it went down.** 45 real H10
nights through the shipped `accExtras` agreement block: RRacc vs EDR gives median **r 0.07**, MAE
**2.5 br/min**, bias **+1.58** (one-signed on 45 of 45), 95 % limits typically **−4 … +7.5 br/min**
(±44 % of a ~16 br/min mean) and a median **27 %** of paired epochs >3 br/min apart. The card's
standing defence — a low r reflects EDR's narrow range, Bland–Altman governs when the spread is small
— does not rescue it: by the statistic it nominates, the two do not agree. So `rraccRate` moves
`emerging` → **`experimental`**, with the numbers in its cite and the per-night table in
`docs/ECGDEX-RRACC-EDR-AGREEMENT-2026-09-01.md` so the tier is re-checkable rather than asserted.
`edrAgreement` keeps its tier (it is the agreement STATISTIC, and its standing does not depend on the
answer being positive) with its cite corrected; `edrDisagree` keeps `heuristic`.

**The strongest evidence claim on the card was prose, not a badge.** It printed "they agree to within
N br/min, cross-validating both" whenever two WHOLE-NIGHT means differed by <2, while a quarter of the
paired epochs behind them differ by >3. It now prints the paired-epoch limits, the bias and the >3
br/min share, and says outright that a whole-night Δ is not an agreement statistic.

Posture gets its own registry entry (`accPosture`, `experimental`, inheriting MotionDex `supineFrac`'s
uncalibrated-frame reasoning). That made a second contradiction visible: the **ECGDex Reference guide
graded posture `measured`**, the top tier, for a mount-dependent convention — invisible while
'Posture' resolved to no id, so `cohesion-badges` had nothing to compare. Fixed in the DOC per §🎫,
and the card now separates the mount-independent tilt angle from the named position.
