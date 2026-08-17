---
bump: patch
type: fixed
brief: OXYDEX-FFT-CYCLE-NULL-2026-08-16-BRIEF.md
---

`peakCycSec` and `peakFreqHz` get `oxydex-registry.js` rows at `experimental` — the last open code item
in the FFT-null brief. Both reach the user (the CSV carries "FFT Peak Freq (Hz)" / "FFT Cycle Length
(s)") and neither had a registry entry, so a badge helper resolving them fell through to the
fabricated-`experimental` default — a tier that happened to be right for the wrong reason, which is the
fabricated-authority shape §🎫 exists to prevent.

`experimental` matches the published guide card (`ev-experimental`) and is argued in the entry: the
metric now has a genuine null and publishes `snr`/`threshold`/`rhoLag1` so the verdict is auditable, but
the claim that a surviving peak is a *physiological* cycle has no external reference. `heuristic` would
undersell the null work; `emerging` would assert a validation nobody has done.

Aliases cover the CSV headers and the guide card in both subscript spellings ("SpO₂ FFT" / "SpO2 FFT" /
"Dominant Frequency (DFT)"), each verified to resolve. Registry is in the compute closure, so
`computeHash` moved and the corpus re-verification was run, not asserted: suite green, 2 fixtures
re-stamped `verifiedUnder → 0f0b97dd2fcb`.
