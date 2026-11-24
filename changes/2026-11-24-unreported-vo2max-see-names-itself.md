---
bump: patch
type: fixed
brief: LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md
---

Both VO₂max cards printed `(±' + (v.see || 0) + ' SEE)`. A result that carried no `see` then read
"±0 SEE", which is a perfect estimate, beside a range that is ±10.8 wide. The two numbers in one
sentence disagreed.

- `oxydex-render.js` gives both cards one pure local `_vo2RangeHtml(v)`. It prints the SEE clause
  only for a finite `see`, and it names the absence as `SEE not reported` otherwise. A measured SEE
  of 0 still prints, because the test is finiteness and never truthiness.
- `oxydex-profile.js` is the one producer that reached the contradictory state. The profile edit of a
  night with no earlier `vo2est` creates the object, writes `vo2Low` and `vo2High` from a literal
  10.8, and never wrote `see`. It now reads the result's own `see` where the DSP wrote one, which
  keeps a trained-athlete 5.4, and falls back to the general-population value the DSP cites. It
  writes that number back, so the printed range and the printed SEE come from one number.
- `oxydex-dsp.js` sets `see` on every path, so the DSP never omitted it. The repair is NOT
  export-inert: `manifest-gate.js` keeps `oxydex-profile.js` inside the compute closure, because the
  DSP reads `upVO2category` from it inside `compute()`. OxyDex moves both hashes, six fixtures carry
  the new identity with no output value moved, and the cohort yield pin names a paper-scale re-cut
  that came back on the same counts.
- `tests/dex-tests.js` gains one group. It slices `_vo2RangeHtml` out of the source and RUNS it over
  a finite SEE, a 5.4, a 0, an absent `see`, a null, an undefined, a NaN and a string, and it pins
  the producer half.

Per the §∅ ruling an unreported standard error is null, and never a 0 that reads as certainty.
