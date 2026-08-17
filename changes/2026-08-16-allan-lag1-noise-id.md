---
bump: minor
type: added
---

**`classify` names a noise type from a fitted slope, so near a boundary it must refuse. This one fits no
slope, so it has no boundary.**

`INTERDISCIPLINARY-LITERATURE-DIAGNOSIS-2026-08-16-BRIEF` §2.1 keeps slope-as-noise-diagnostic as
[ALREADY CORRECT], asking only for confidence reporting and an input-validity check around it. This
takes the other route.
**Riley, W. J. & Greenhall, C. A. (2004)**, *Power law noise identification using the lag 1
autocorrelation*, Proc. 18th European Frequency and Time Forum, Guildford, 5–7 April — identify the
power law **analytically**, from the lag-1 autocorrelation, at any averaging factor, without fitting
anything.

That breaks the circularity `classify`'s docstring correctly declines to reason around: a full Riley EDF
treatment needs the noise type in order to compute the confidence interval that decides the noise type.
An estimator that computes no slope has no standard error, no boundary, and nothing to be near.

## It is published BESIDE `classify`, not instead of it

⚠️ **This is the precondition the brief carries, and it is load-bearing.** `#1334` pinned **three**
implementations of the slope-threshold rule — `clock.js CK_ALLAN_NOISE`, `ppgdex-dsp.js ALLAN_NOISE` and
`_NOISE` here — with a gate asserting the tables are equal. Replacing only the Python one would put the
lanes on **genuinely different algorithms** rather than the same algorithm with different rounding, and
a table-equality gate structurally cannot express that. `_NOISE` and `classify` are byte-untouched; a
test asserts it.

So `stability()` now carries two independent opinions. **Disagreement is information, not an error.**

## Known-answer validated across the whole family

`allan.py` had no external reference for its noise naming — the brief notes AllanTools implements the
same identification, which makes this checkable rather than re-derived. All five recovered from
synthesised series of known type:

    white PM    alpha +2      flicker PM  alpha +1      white FM  alpha 0
    flicker FM  alpha -1      RW FM       alpha -2

## On the real corpus it resolves what ADEV cannot

    stream   classify (slope)        lag1 (analytic)
    H10 ecg  white/flicker-phase  -> flicker-phase
    H10 acc  white/flicker-phase  -> flicker-phase
    Verity   white/flicker-phase  -> white-phase
    Verity   white/flicker-phase  -> white-phase

Every stream gets ADEV's ambiguous joint arm; the lag-1 identifier splits them — and splits them **both
ways**, which is the anti-vacuity check that matters. This is the same resolution MDEV provides, obtained
without computing a second curve.

⚠️ **TWO STATISTICS SHARE THE WORDS "lag-1 autocorrelation".** `METROLOGY-METHOD-ADOPTION` §5 celebrates
a two-line lag-1 check that asks *is this series correlated at all* — a plain correlation test. This asks
*which power law is this*. Same words, different question; citing the former as evidence for the latter
would be wrong, and the two briefs sit close enough in a semantic search to invite exactly that.

⚠️ `alpha` is clamped to [−2, +2]. Outside it the series is not one of the five power laws this names,
and a sixth label would be invented rather than measured. `None` when the series is too short, or when
differencing would exhaust it before it decorrelates — that path is covered by a cubic that stays
correlated through two differences and runs out on the third.
