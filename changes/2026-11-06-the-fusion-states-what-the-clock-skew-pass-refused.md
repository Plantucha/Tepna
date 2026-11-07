---
bump: patch
type: fixed
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

The Integrator's clock-skew banner fires on a finding. A recording the pass vetoes produces no finding, so a night whose every recording carried a recorded seam or a declared RTC reset printed nothing. That blank screen reads exactly like a night whose clocks agree.

The app now states what the pass refused. Each veto reaches the reader with the note the DSP already wrote, naming the node and the cause. A pass that refused every recording says so, so the quiet above it reads as refusal rather than agreement.

A measured zero stays silent, because a banner on every clean night is noise. An unexamined channel gets its own line, grouped by the node's own reason token.
