<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
ECGDex no longer reports a QT/QTc that is really the median-beat window edge. The median beat is a fixed window (`pre=0.32·fs`, `post=0.46·fs` → 460 ms after R), so when repolarisation genuinely outruns it the T-end tangent extrapolates past the last sample and was silently clamped to `beat.length-1`. QT stopped being a measurement and became a **ceiling**: at 130 Hz every such beat reported `ms(edge−Qon)` ≈ 500 ms regardless of the true interval, a plausible number sitting on a clinical threshold — and two beats with materially different repolarisation collapsed to the identical value. Unlike QRS there is no `medW`-style cross-check to re-anchor T-end onto, so the honest move is to withhold: `delineate` now returns `qtSaturated` and nulls `qt`/`qtcBazett`/`qtcFrid` when the T-end could not be delineated inside the window (no downslope, tangent past the edge, or a T peak on the truncated search boundary) — the same treatment `pr` already gets when P is absent.

This also removes the `unstable` inversion in `qtcTrend` at its source. Saturated windows no longer reach the trend, so the reference median is computed over well-delineated windows only. Previously they could form the **majority**, making the median itself the pinned value — so the windows exceeding 60 ms were the *correctly* delineated ones, and `qtcTrendNote` told consumers (including the GlucoDex hypoglycemia⟷repolarisation feed) to discard exactly those. The note now also states that a shorter trend means windows were withheld, not that the night was quiet.

7 new assertions on the real window geometry, mutation-verified in both directions: removing the withholding republishes `qt=500`; hard-disabling the guard republishes the full fabricated triple (`qt=500 qtcB=527 qtcF=518`); hard-enabling it reds the in-window case, so the guard cannot pass by nulling everything. Export-inert — **proven**: the ECGDex real-corpus fixture re-ran through the suite and reproduced byte-identical (`verifiedUnder → 79ba8600a7f9`, no output byte moved).
