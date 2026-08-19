---
bump: patch
type: changed
---

**`TCH-FUSED-ROBUST-HAT-FOLLOWUPS` finding 6 / Do 5 (`bSQI` is "silently ≈ 0 corpus-wide") CANNOT BE
VERIFIED without a code change — which is why it has sat unmeasured.** Established 2026-08-18:

1. **`bSQI` is absent from every export.** All 55 ECGDex trio nights carry `quality: {analyzablePct,
   cleanBeatPct, coveragePct}` and no `bSQI` at any depth — so no consumer can see it.
2. **It carries 0.28 of the composite per-beat SQI** (`0.30·kSQI + 0.28·bSQI + 0.24·rrPlaus + 0.18·ampOK`),
   the second-largest term. If the claim is true, that composite runs on 72 % of its intended inputs.
3. **It is unreachable from outside the module.** `detectPeaksB` is not on `ECGDSP`; the exported
   `computeSQI(int16, fs, peaks, times, peaksB)` *requires* `peaksB`, which only `detectPeaksB` produces;
   `hrConfidence` computes both internally but returns beat confidence, not the SQI terms.

**So Do 5's first step is not "fix `detectPeaksB`" — it is "make `bSQI` observable".** Export the detector
or surface the per-term SQI breakdown, measure the corpus, *then* decide whether the adaptive threshold is
worth building. Fixing a detector whose output nobody has measured is exactly how the zero-leverage changes
in Do 2 and Do 4 nearly got built.

⚠️ **Re-implementing `detectPeaksB` outside the module to "check" it was considered and rejected** — that
measures the reimplementation, not the shipped detector, which is the fake-written-from-the-implementation
trap `POLAR-ONBOARD-BACKUP-FOLLOWUPS` §5 documents.

No code change.
