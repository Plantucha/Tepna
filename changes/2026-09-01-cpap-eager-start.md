<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [capture-host]
brief: CPAP-EAGER-START-2026-09-01-BRIEF.md
---
CPAP auto-start is now EAGER — the live stream starts at the first Therapy sighting (removing the measured 147 s head gap: ~120 s gate + ~27 s stacked poll latency), and the 120 s continuous-therapy rule becomes a RETENTION decision: a session whose stream lives < retain_s + auto-stop hold is judged a false start from its own lifetime, its fragment discarded with a journal line per file, and an attempt spent from the same per-session budget — which now survives note_started, or repeated false starts could never exhaust it.
