<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md
---
Enforce `find_unwired.py --check` in `capture-host-ci.yml`. It was a local-only gate (run by `check.sh` but not CI), so a published status key or public function that reached nobody could sit on `main` indefinitely — the "gate that protects nobody" class. Now every capture-host PR runs it, before the pytest lap so a structural break fails fast. Discovered while landing CPAP hardening P3 (#1688).
