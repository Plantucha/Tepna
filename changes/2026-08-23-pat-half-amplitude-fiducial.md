---
bump: minor
type: added
brief: EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md
---

`tools/pat-fiducial.mjs` — the half-amplitude pulse fiducial §1 needs, derived from what the shipped
detector already emits (`bandpass` → `detectChannel` → `{peaks, feet}`) so the comparison changes the
fiducial and nothing else. **`ppgdex-dsp.js` is deliberately untouched** — this is an experiment, not a
proposed fix, and PpgDex carries pending owner decisions.

Ajtay et al. (2023, *Biomed. Signal Process. Control*) rank the 1/2-amplitude point best and the base
point worst for beat-to-beat PAT imprecision; PPGDex uses the base, and PAT recovers on 6 of 38 nights.

The crossing is **linearly interpolated** between bracketing samples: at 55 Hz one sample is 18 ms,
the same order as the PAT differences being chased, so rounding would put a quantisation floor on the
quantity under test. An unusable edge returns `null` rather than a guess, so callers count coverage.

Selftest: exact midpoint on a linear ramp, a deliberately between-sample crossing recovered as 1.1
(a rounded implementation would say 1 or 2), refusals on flat/falling/inverted edges, and ordering.
