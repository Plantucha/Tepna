<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md
---
The standing PAT verdict in one place: blocked by ~90 ms of beat-to-beat scatter that is downstream of the heart, with every other candidate measured and eliminated.

Five PAT verdicts have been published from this repo and the reasoning was spread across four briefs — one whose title claim is withdrawn, three carrying retractions. This is a **consolidation, not a replacement**: each brief remains the primary record for its own measurement and there is **no new evidence here**.

**Eliminated:** crystal drift (`halfDrift` 47/54, implied 1.46 ppm) · beat-slip in the coupler ("1147 ms IS one RR", fixed and gated) · the ACC alignment (anchors disagree with *themselves* by 1171–3094 ms inside one pair) · pair selection (legacy `matchRate` spans 0–77 % across pairs of one night) · offset identifiability (~450 ms band mod one RR) · the host clock itself (phone tree has no independent host column, 76/76 files at 1 ms) · no valid non-beat anchor (one derived; 6/38 nights, 0/13 box) · the PPG timing point (foot vs peak, −0.5 ± 5.1 points over 45 windows) · and the **pre-ejection period** — arm→finger cancels PEP by construction and the scatter does not collapse (92 ms vs 84, 1/43 clearing the bar).

**What remains:** `residIQR` ≈ 96 / 84 / 92 ms, measured three ways in two harnesses, offset-free by construction in all of them, against a 60 ms bar. Windowing helps (10/52 vs 0/54 whole nights) and is an order of magnitude short.

**Only two things could change it, neither analysis:** a tighter foot — the Verity now runs 176 Hz where this corpus is largely 55 Hz and one sample is 18 ms, which makes `PPG-SAMPLE-RATE-AND-PAT` the most promising open item — or a longer transit path. More clock work, a better anchor, a different alignment, and dual-site differencing are each measured out.

Also records the method warnings this family paid for: a statistic whose reference comes from the data it tests cannot fail (twice); concluding from the best available case; selecting on the outcome, where the fix is enumeration rather than a better rule; and reading the sibling briefs first.
