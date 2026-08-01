<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PPGDEX-PI-AND-PARSE-FOLLOWUPS-2026-07-12-BRIEF.md
---
Close the companion-parse optimization as NOT ACTIONABLE — all nine consumers of `parseSensorXYZ` read `tMs`, so the proposed opt-out has nowhere to go.

`patch`, docs-only: the `opts.stamps` shape was implemented, measured (1.78x, not the proposed 2.08x) and
reverted unshipped rather than land a knob no caller can pass at the cost of a fleet re-bundle.
