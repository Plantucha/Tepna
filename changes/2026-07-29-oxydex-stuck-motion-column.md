<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: MULTINIGHT-CORPUS-FINDINGS-2026-07-29-BRIEF.md
---
OxyDex now rejects a faulted motion column instead of integrating it. On 2026-07-16 and 07-17 it published `motionPct 100`, `sleepEff 0`, `arousalIndex 100`, `wasoPct 100` — **a confident description of a night that did not happen** — with nothing in the export marking it, while every motion-*gated* metric silently ran on an empty sample set.

**The defect.** `motion > 0` is read as movement. When the capture host wrote a motion field pinned at ~19–27 for hours on end, every sample qualified. `computeHRV` already self-nulled (it had no motion-free samples to work with, which is the honest response); `computeMotionProfile` and `computeMotionSleep` did not, and reported the saturation as fact.

**The brief's proposed detector was wrong, and measuring is what found it — recorded because the correction is the useful part.** §3 assumed the fault was per-night and proposed flagging `motionPct == 100`. It is per-**source**: the host's live BLE stream never returned to zero, but **the O2Ring's own onboard `.dat` backup for the same nights is 94–98 % zero**. The device reports motion correctly; the host's live decode of that byte does not. A folded night merges both, so its overall zero-fraction is a healthy-looking **50–63 %** — and the first implementation, built to the brief, duly **missed 2026-07-17**, one of the two nights the fix exists for. It went in green and passed its own tests.

**What works is the longest contiguous run of non-zero samples** — it asks the question locally and needs no source provenance. Measured over 13 consecutive capture nights:

| | longest unbroken all-moving run |
|---|---|
| 2026-07-16 / 07-17 / 07-18 (faulted) | **110 min · 366 min · 302 min** |
| 2026-07-19 … 07-28 (every healthy night) | **3 s – 13 s** |

~500× apart with nothing in between, so the 10-minute threshold is **read off a gap rather than chosen**: 46× above the worst healthy observation, 11× below the smallest fault. A sleeper who genuinely never stills for ten minutes does not then produce a night whose next-longest run is four seconds — the shape is a writer, not a body. This also makes 2026-07-18 decidable, which no fraction test can be: 18.7 % zero looks like a restless night by fraction and is five hours of impossible continuity by run.

**The response** follows the `_durBad`/`durationInflated` precedent in the same file — surface the absence, never publish a plausible wrong number. On a faulted night `motionProfile.*` and `sleepQuality.*` go null, `stats.motionPct` goes null (not 0 — that would report a perfectly still night, the opposite of the truth), and `motionProfile.columnStuck: true` marks *why*, so a reader can tell a faulted sensor from an oximeter that never had a motion column. The whole night's motion family is dropped even though the fault is per-source, because a merged night carries no source provenance by then and a part-fabricated series cannot be partially trusted.

**One consequence found while wiring it:** `computeSleepStabilityScore`'s motion subscore is `(2.0 - motionPct)/1.8`, so a null input clamps to a **perfect 100** — a stuck sensor would have scored the night's stillness top marks. That is precisely the fabricated-absence bug the note above the sibling HR subscore exists to prevent, so the component now drops out and the score renormalizes over what was measured. The renormalization generalizes the previous s2-only branch and is arithmetically identical where it applied (divisor 1.0 with nothing null, 0.9 with only the HR subscore null), so no existing export moves. Same reasoning applied to the multi-night rollup's `motionPct: s.motionPct || 0`.

**Corpus check:** 2026-07-16 and 07-17 now export `motionPct: null` + `columnStuck: true` with `sleepQuality: null`; the controls (07-18's folded window, which draws from the healthy `.dat`, plus 07-22 and 07-27) are untouched at 0.9 / 0.5 / 0.3 %.

**Coverage.** New group (15 assertions) pins the faulted shape, the merged healthy+stuck night a fraction test cannot see, the worst healthy run in the corpus (13 s) as clean, the fraction-vs-run 07-18 case, both sides of the threshold, and the empty/absent/no-column edges — plus the subscore renormalization with its unchanged control.

OxyDex re-bundled (`manifestHash 7b6d881590b0 → 4c959b483a0e`) plus `docs/`, both orchestrators and the 5 analysis pages inlining `oxydex-dsp.js`. `computeHash` moved `aa03ffbb3553 → 7c9fe8f58829`, so this is a re-verification, not an inertness claim: `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs` re-ran the app and re-stamped both OxyDex summaries → `verifiedUnder: 7c9fe8f58829`; **no fixture output moved** (neither committed night has a stuck column). `run-tests.mjs` **4231 green, 0 skipped** against the real corpus, `verify-manifest` GATE A 9/9 + GATE B 13 reproducible, `build --check` clean (11 owned).
