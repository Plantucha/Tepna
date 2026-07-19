<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [oxydex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Three OxyDex desaturation-family defects, all scored against the wrong set or the wrong denominator.

**§2.2 — `desSev` measured the noise floor.** The area was integrated over events detected at `dropPct:1, exitPct:1, minSec:0`. A 1 % descent with no minimum duration is not a desaturation: on a synthetic hour of ordinary 1 % ripple that primitive returns **441 "events"** against 2 real ones. Across the 37-night O2Ring corpus the index spanned **27.8–61.8 %-min/hr**, the "good" band (`<5`) was unreachable on **every** night, and `desSev` — ranked by magnitude — was published as the **#1 finding** on real nights purely because it was saturated. `ahiKulkas`, which weights it 0.6, ran a median **17×** its sibling `ahiODI4`, reporting 24 ("moderate apnea") against 1.2 ("normal") on the same recording. It is now scored over the canonical ODI event set (≥4 % descent, ≥10 s) — the same events every other consumer uses. Corpus range becomes **0.24–17.6** (median 3.76), which separates 26 good / 10 warn / 1 high, and `ahiKulkas/ahiODI4` falls to a median 2.95×. Kulkas' area-under-the-curve concept is unchanged; only the event set is.

**§2.1 — SBII re-litigated an exclusion that had already been made.** It re-ran the primitive itself and never read `desat.events`, so it scored the **ungated** set — re-admitting probe-squeeze artifacts that `processNight` had explicitly subtracted from ODI-4, and doing so with **quadratic** weight (D²·T). On the twin, gating one of two events moves SBII 60.667 → 18 and crosses a quintile boundary (Q5 → Q4), matching the audit's "3 of 11 nights change quintile". The `durationHr` denominator is deliberately untouched (ratified).

**§2.3 — `gapPct` divided gap SECONDS by a SAMPLE COUNT.** Dimensionally wrong, and only ever plausible because the O2Ring samples at exactly 1 Hz. Biased high (numerator counted missing time, denominator only recorded samples) and unbounded above 100 %. Now gap seconds ÷ wall-clock span, clamped to a real percentage.

Also **reconciles the three classifiers**, which disagreed: the chip used `{10,25}`, the metric card `{5,15}`, the score `{5,15,30}` — so one night could read green on the chip and warn on the card beside it. `{5,15,30}` is canonical and is validated by the corrected scale. The **reference guide is corrected too**: it documented `DesSev = ODI-3 × mean_depth × mean_duration / k`, a formula the code has never implemented.

Adds **`tools/regen-oxydex-goldens.mjs`** — OxyDex was the one code-gated node without a regenerator, so there was no sanctioned way to move an output byte. 9 new assertions on one synthetic twin, mutation-verified in both directions: reverting the desSev thresholds republishes 37.75; reverting SBII's source republishes 60.667 and collapses the quintile split; reverting the gapPct divisor republishes 25.1. All 3 OxyDex fixtures regenerated (never hand-edited) and re-verified: suite 3132 zero-skip, GATE B 25/25 reproducible.
