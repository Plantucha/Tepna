---
bump: patch
type: removed
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---

The PAT worker no longer emits detailCorr — the packed per-beat detail for the ACC-corrected coupling that was computed, sent across the worker boundary and read by nobody since 2026-09-02. Its parent finding closed as MOOT (work with no consumer), so the field is deleted rather than surfaced; the corrected coupling's summary (cpCorr, vdCorr, accSync) is read and stays. The dead-cross-boundary gate's known-dead ratchet drops to zero, with a plant that proves the detector still fires.
