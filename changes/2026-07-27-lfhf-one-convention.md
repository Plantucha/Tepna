<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex, ECGDex]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
LF/HF is now one convention across the fleet: the median of the per-segment ratios. The Task Force defines LF/HF within a single stationary ~5-min spectrum, so aggregating a night means summarising per-segment ratios; the quantity is right-skewed, which makes the median the appropriate summary; and ECGDex and PpgDex already did it this way, so PulseDex was the 1-of-3 outlier. Because a ratio-of-medians differs from a median-of-ratios whenever the per-epoch distribution is skewed (4.7%-18.7% apart across 13 real nights), the Integrator was reading a purely definitional gap into one `hrvConsensus.lfhf` spread and publishing it as sensor disagreement on identical beat truth. Separately, `lf / (hf || 1)` fabricated a ratio when HF was zero — a ratio with no denominator is not a small ratio, it is no ratio — so the surfaced field is null there and ECGDex's night-level median drops null epochs rather than counting them. One committed fixture moved and was re-recorded through the sanctioned regen tool: `hrv.frequency.lfhf 0 → 0.207`, where the old zero came from rounding the bands to integers before dividing, which is itself an argument for taking the ratio per window. PulseDex's `ansBalance()` carries the same `hf || 1` but feeds a logistic-squashed SNS/PSNS score, so what that KPI should read when HF is zero is a separate decision and is filed, not silently changed.
