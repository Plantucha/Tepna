---
bump: patch
type: added
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---

`pat-window-oracle.mjs` gains `--search-max` and `--json`. The first varies the interval the mode is
**searched in**; the second emits the per-night record including `modeN`, the null's own mode, which the
human table never printed and which is the only way to ask whether a shifted train reaches PHYS as
readily as a real one. Defaults unchanged — the shipped run reproduces `315 / 215 / 225` exactly.

**Why it mattered.** `PPG-FOOT-PLACEMENT`'s bar and WINDOW-ORACLE's SIGNAL RECOVERED verdicts are
stated **in modes**, and §4a's invariance evidence sweeps `--half-width` — the band drawn *around* the
mode, not the interval it is searched in. The two are independent and only the second had never been
varied. `PAT-FORENSICS-WINDOW-REGIMES` §9 had just shown the sibling statistic, the median, to be
nothing but the interval it was computed over (slope 0.964/0.934), so the question was live.

**Q1 — MODE IS ROBUST, both trees.** Identical at M = 1000/2000/3000 on **38/40 (95 %)** and
**44/46 (96 %)** of scored nights, median |Δ| **0 ms**. The mode is a real statistic; the median was
not.

**The two nights that move are the interesting part, and they vindicate the shipped default.** Both are
already `ARTIFACT REFUSAL` at M = 2000, and `2026-08-28` shows why: **545 ms (inside PHYS) at M = 1000 →
1245 ms (outside) at M = 2000 and 3000.** The *narrower* search truncates away the true modal peak and
settles on a secondary one that looks physiological — so a tighter bound would manufacture an in-rail
answer. `MODE_SEARCH_MAX = 2000 // wider than the PHYS window ON PURPOSE` is doing exactly what its
comment claims.

**Q2 — CALIBRATED.** `papers/dead-ends.html` records this repo burned by a search whose threshold
"sits below the chance-maximum correlation over 24,001 candidate lags", prescribing *"calibrate the
search before believing its null"*. Measured against the tool's own circular-shift null:

```
            real mode in PHYS      null mode in PHYS       Δ
box   M=2000      70.0 %                40.0 %          30.0 pts
smoke M=2000      73.9 %                39.1 %          34.8 pts
```

Pre-stated: CALIBRATED at Δ ≥ 20 pts. It clears on both trees at every bound.

⚠️ **But the null reaches PHYS 40 % of the time, and that rate does not move with the bound** (40/40/40
against a uniform-chance baseline of 45/22/15 %). A circularly-shifted foot train is therefore **not**
producing random lags — it concentrates, and the concentration is bound-invariant. So "the mode is in
the rail" is meaningful **in aggregate** and weak **on a single night**: roughly two in five shifted
trains produce a physiological-looking mode.

⚠️ **A methodological note kept because it nearly shipped.** My first Q2 pass filtered out refused
nights and reported the real arm at **100 %** — circular, because `ARTIFACT REFUSAL` is *defined* as a
mode outside PHYS, so excluding refusals guaranteed the answer. The honest figure over all nights with
a mode is 70–76 %. Rule and prediction were both written before any non-default bound ran; Q1's
prediction (ROBUST) was confirmed, and Q2 was pre-registered with **no** prediction, which was the
honest state.

Closes residue `2026-09-14-oracle-mode-search-bound-never-varied`.
