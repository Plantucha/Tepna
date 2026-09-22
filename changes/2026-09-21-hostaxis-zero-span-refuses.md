---
bump: patch
type: fixed
brief: KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS-2026-08-14-BRIEF.md
---

DexClock.hostAxis refuses a zero-span device axis with a named reason instead of returning ok:true, ppm:0, independent:true — a rate over a zero span is not 0, it does not exist, and the old 'span > 0 ? … : 0' was the fabricated zero at the rate. Deliberately narrow: the general drawn axis (uniform counter, span > 0) is still admitted and published as deviceDrawn. ECGDex publishes the refusal as such (planted); PpgDex already did. The pre-existing assertion that pinned the fabricated zero is re-pinned to the refusal.
