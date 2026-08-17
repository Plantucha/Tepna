<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: none
---

CPC computed the HFC/LFC/VLFC shares as **night-level means and threw the per-window structure
away** — which is the part CPC actually exists for. Thomas et al.'s method produces a *profile*
across the night: stable sleep, unstable sleep, REM/wake. A single mean cannot say **when** sleep
was stable, which is the whole clinical content.

`_cpc` now returns `series` (one entry per window: `tSec`, the three shares, and a `state`) plus
`stableMin` / `unstableMin` / `remWakeMin`. Existing fields are untouched, so every consumer of
`hfcPct`/`lfcPct`/`vlfcPct` is unaffected.

**⚠️ THE CLASSIFIER CANNOT USE RAW SHARE, AND THAT IS THE ENTIRE DESIGN.** The bands are wildly
unequal — HFC spans 0.30 Hz, LFC 0.09, VLFC 0.006 — so "which band holds the most power" answers
**HFC on pure noise**, measured 11 of 11 windows. That is the same low-frequency/high-frequency bias
the *integrated-share* estimator was introduced to remove (see the note at `ecgdex-dsp.js` on the
argmax estimator's 5× over-pick), and a per-window classifier reintroduces it unless corrected.

The fix is power **density**: share ÷ the band's own bin count, with the bins counted from the live
`kLo`/`kHi` clamp rather than hardcoded, so the null cannot rot if a band edge moves. Measured:

```
white noise      raw shares  72.6 / 25.8 / 1.6   (≈ the documented 76/23/1.5 bandwidth null)
                 classified  3 hfc / 3 lfc / 5 vlfc      — near-uniform, not collapsed
planted 0.20 Hz  11/11 HFC   stableMin 46.9
planted 0.02 Hz  11/11 LFC   unstableMin 46.9   — and zero leakage either way
```

**Durations are charged per STEP, not per WINDOW.** Windows overlap 50 %, so billing each one
`WIN_SEC` would double every reported minute — a wrong number that looks entirely plausible. The
final window's tail is not counted; it is one step of a multi-hour night, and inventing it would be
worse than under-reporting it.

**`lfcVals` was dead** — declared, pushed every window, never read. It now backs `lfcWindowSd`.

**⚠️ NAMING IS A CLAIM, and this one is deliberately narrow.** These are CPC's three states, **not**
the AASM stages. CPC has never been a stager: it partitions sleep by coupling *stability*, which cuts
across N1/N2/N3. `remWakeMin` must not be read as REM minutes, and none of this should be compared
with `deepMin`/`remMin`, which estimate a different thing from a different signal and remain
`heuristic`. Nothing here is registered as a metric or surfaced; that needs a labelled reference this
repo does not have (`AUDIT-FOLLOWUPS` §5.1, data-gated).

Gate: new `ecgdex · cpc` group, 10 assertions. **Seen to fail**: reverting density to raw share
collapses all 11 noise windows onto HFC and fires both bias assertions, while the eight others still
pass — so the gate discriminates the correction specifically, not merely the code's presence.
`ecgdex` group **1109/1109 against the real corpus** (`DEX_UPLOADS` set) — the equivalence legs ran
rather than skipping, so the node export is confirmed unmoved. `lint` and `typecheck` clean.
