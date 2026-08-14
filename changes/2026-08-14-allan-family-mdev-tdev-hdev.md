---
bump: minor
type: added
brief: METROLOGY-METHOD-ADOPTION-2026-08-14-BRIEF.md
---

`capture-host/allan.py` gains **MDEV, TDEV and HDEV** — the rest of the frequency-stability family it
had been holding one member of.

**Why a second curve at all.** ADEV maps BOTH white phase noise and flicker phase noise onto τ⁻¹, so
its `white/flicker-phase` verdict is not one answer — it is two answers ADEV structurally cannot tell
apart. MDEV's inner average over m second-differences applies a software bandwidth that scales with τ
and puts white PM at τ⁻³ᐟ². Measured on a synthetic white-PM series: **ADEV −1.000, MDEV −1.513**. The
new `identify()` reads both curves together and publishes the resolution, or `None` when the pair
licenses no split.

**TDEV is the one the uncertainty work actually needed.** σ_x(τ) = τ/√3 · Mod σ_y(τ), reported in TIME
units rather than fractional frequency. ADEV answers "how stable is this oscillator"; TDEV answers "how
much timing error does it contribute at this averaging time", which is the quantity a PAT budget
consumes and the reason this phase came first.

**HDEV is blind to the drift ADEV reports.** Its third difference annihilates a linear frequency drift.
On a pure-drift series: **ADEV +1.000, HDEV −1.028** — ADEV is reporting the ramp, HDEV has removed it.
Not academic: the O2Ring's real error is −3035 ppm decaying to −1622 ppm, so ADEV there measures the
drift instead of the noise underneath it.

⚠️ **MDEV slopes are NOT ADEV slopes, and mixing the tables is silently wrong** — white PM would be
labelled flicker PM every time, and both are plausible answers for a wearable link, so nothing would
look wrong. `classify_mdev` exists so the caller cannot get it wrong by omission; `_NOISE_MDEV` carries
the separate exponents.

⚠️ **Each estimator computes its OWN term count.** MDEV needs N−3m+1 and HDEV N−3m against ADEV's
N−2m, and `_octave_taus` now takes the estimator's counter. Reusing ADEV's would offer averaging times
the other two cannot support — publishing exactly the thin, wide-CI number this module's docstring says
it exists to refuse. Gate-pinned: at n=30 and τ=11, ADEV reports and both others decline.

MDEV's inner sum is carried as a **sliding window** — written directly it is O(N·m) per τ, so O(N²)
over an octave ladder, minutes on a 25 000-sample night. The optimisation is pinned against a direct
transcription of the definition at five values of m, because an optimisation that changes the answer is
a bug.

**TOTDEV deliberately not added**, with a measured reason rather than a backlog note: it buys confidence
as τ approaches T/2, and `_octave_taus` already stops at τ ≤ T/8, so it improves a range this module
declines to report.

Back-compatible by construction: `slope`/`slope_se` gained an optional LAST `key`, `classify` an
optional LAST `table`, `_octave_taus` an optional LAST `terms_at`. `stability()` and its `nightqc.py`
caller are untouched — wiring the new curves into the nightly record is a separate decision.

Python lane only — no bundle, no `manifestHash`, no fixture affected. 20 new tests; `allan.py` holds
**100 % statement and branch** coverage.
