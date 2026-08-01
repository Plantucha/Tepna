<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md
---
Closes `POOLED-CLOCK-FIT-FOLLOWUPS` — all six done-when items resolved.

§1's bimodal latency was the **fiducial**, not physiology: `autonomic_surge` stamps the bradycardia trough, and re-measuring against the rebound turns a bimodal +10/−20 distribution with a hole at simultaneity into one mode (1.0 % → 36.1 % within ±5 s). §3's proposed disagreement guard is **rejected with the measurement that rejects it** (22 of 22 correct nights falsely flagged). §5's window is **swept and chosen** (`matchSec` 45 → 30). §4's `--allow-partial` lands, and it was **42 nights, not 4**.

The last item asked for "a detector fix and a gate". The fix is in the **emitter, not the detector** — `detectCVHR` is correct and the bradycardia is the right CVHR fiducial, so `tMs` is unchanged; what was missing was any statement of which instant it marked, and the rebound, which `meta.peakTMs` now publishes.

**Recorded rather than left to be discovered: `peakTMs` has no consumer today.** The obvious one — feeding the clock fit the rebound — was tested and does not help (22 → 21 confident nights, MAD 15.6 → 13.2 s; pooling absorbs one channel's 20 s offset, which is what pooling is for). It is published for cross-channel physiology, where 20 s is the whole signal. Unused today is a measured decision, not an oversight.

One question is carried forward in §7 rather than answered: the partial nights that clear their null land at **39.3–42.0 min** against a 38.28 min consensus. Consistent with genuine CPAP clock drift over May–June, and equally consistent with single-channel bias — not claimed either way, and now measurable across the corpus §4 doubled.
