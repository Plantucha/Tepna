---
bump: patch
type: fixed
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

PpgDex decided optical polarity from the SKEWNESS OF THE FIRST DERIVATIVE, a third moment on a noisy
derivative that flips under low-frequency contamination — measured WRONG ON 10 OF 20 real box nights.
An inverted pulse is processed upside down and every downstream number is silently wrong: the ensemble
minimum lands after the peak, the "upstroke" is a ~1000 ms ramp rather than ~160 ms, the foot is placed
~900 ms early, and inter-LED scatter goes 1.7 ms to 25-42 ms. The consensus-polarity pass cannot catch
it: it acts only on a DISSENTER and returns 0 when channels are unanimous, so unanimously-wrong reads
as unanimously-right — which is also why the error is common-mode and invisible to any inter-channel
agreement metric.

Replaced with a physiological rule that has no threshold, no moment and no amplitude term: the correct
polarity is the one whose median foot-to-peak rise is a SMALLER FRACTION of the beat interval, because
systole is faster than diastole. Decided from a bounded 2-minute sample taken from the MIDDLE of the
recording (polarity is a device property and constant; the start is donning artefact), falling back to
the old rule when the sample carries too few beats.

Corpus: 20/20 nights now resolve correctly (was 10 wrong), worst night 204.80 ms on 70 paired beats to
3.48 ms on 22335. The committed synthetic rich golden moves analyzablePct/cleanBeatPct/coveragePct
56 -> 98 — CI had been re-running a half-broken result every push. The real-corpus equiv fixture
(2026-06-27, a phone-tree night) is UNCHANGED and re-verified green.
