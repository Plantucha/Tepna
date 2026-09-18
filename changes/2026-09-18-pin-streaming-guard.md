---
bump: patch
type: fixed
brief: CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05-BRIEF.md
---

Pin the `not any_streaming` guard on the new `adapter_responds is False` wedge signal (#2624). Found by
planting the mutant rather than waiting for CI: deleting that guard left the whole suite green, so the
protection existed only in a comment. It is what makes the probe suppression-only in the dangerous
direction — a radio carrying a live stream is demonstrably working whatever a round trip says, so a probe
misread must never be able to power-cycle it (the 2026-07-20 "a needless power-cycle is worse than the
problem" lesson, applied to a new signal). The test asserts its own fixture really streams, and pairs the
suppressed case with the unsuppressed one so it cannot pass by the signal never firing at all. Test-only:
`capture.py` is unchanged.
