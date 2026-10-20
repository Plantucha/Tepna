---
bump: patch
type: added
brief: CVHR-HOLE-EDGE-EXCLUSION-2026-10-19-BRIEF.md
---

A new measurement tool asks what it would cost to exclude a CVHR decision whose support window reaches
into a dropout, rather than only an event stamped on a second the dropout spans. Both detectors decide
at one second from a window that reaches 37 s back and 72 s forward, so a hole adds events on seconds it
does not span. The tool measures the four candidate windows against a phase-matched planted control and
then on every optical stream of this corpus. No node changes here; the brief carries the repair.
