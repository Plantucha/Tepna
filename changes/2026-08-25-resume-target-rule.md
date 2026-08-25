---
bump: patch
type: added
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Add resume_target(), §8b's contact-at-exit rule for a finished held-link pull: worn resumes LIVE,
explicitly-not-worn resumes IDLE_UNWORN, and None (no verdict) resumes LIVE per the daemon's existing
`worn is not False` convention. Completes the pure trio with pull_deadline and flush_gate.
