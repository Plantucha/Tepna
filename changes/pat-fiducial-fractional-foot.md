---
bump: patch
type: fixed
brief: EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md
---

`tools/pat-fiducial.mjs` refused every real beat: `halfAmplitudeIndex` indexed `bp[footI]`
directly while the shipped producer (`refineFeet`) emits fractional foot positions, so on a typed
array that read `undefined` and no rising edge was ever recognised — 15295 of 15295 beats rejected
on the first real night, with the tool's own `--selftest` green throughout on planted integer
indices. Foot amplitudes are now interpolated and the crossing scan anchors its first partial
interval on the foot itself. Gated in the merge suite as `pat · fiducial · half-amplitude`.

Also lands EXTERNAL-METHODS-SURVEY §1's measurement (`tools/pat-fiducial-compare.mjs`) and the
additive hooks it needs in `pat-matchrate-strict.mjs` (`halfTimes` from `ppgFootTimes`, an optional
train for `alignFeet`, `bestPair`/`alignFeet`/`MIN_OVERLAP_MIN` exported). No shipped bundle
changes; `ppgFootTimes.times` is byte-identical, so every existing caller is unaffected.
