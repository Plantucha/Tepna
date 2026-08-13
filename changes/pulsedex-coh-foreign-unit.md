---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

PulseDex `cohEst` and the §B1 foreign-unit veto were pseudo-tested. Both are now known-answer
gated: the coherence ratio, its 0.7 scale and 100 ceiling; and the two-stage defence that keeps an
accelerometer out of the HRV path — the unit veto that decides which COLUMN is chosen, and the
time-conservation law that REFUSES a pure ACC file (measured ratio 52.6 against a 2.0 threshold,
with real beats at 1.09 as the anti-vacuity control). Verified by re-applying 11 mutants: 11/11
killed. No source change — an earlier suspected defect in the veto's fallback was a fixture
artifact and is documented as such.
