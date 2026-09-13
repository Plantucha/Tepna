---
bump: patch
type: added
brief: TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md
---

`briefs/TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md` — a standing reference for what any long-running
analysis tool under `tools/` must do: resumable from its last completed unit, killable, continuously
observable, heartbeat, capability-tiered dispatch that reports the tier taken, pool sized to the
host, generic across callers, and a compute strategy chosen from a profile rather than an assumption.

Eleven requirements, each the negation of a defect measured in this repository, with the measurement
cited so a reader can weigh the rule rather than obey it. Plus a failure catalogue and a pre-flight
checklist.

Doc-only: no gate, no enforcement mechanism, and deliberately so — a checklist that failed a build on
judgement calls would convict working tools.
