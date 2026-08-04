<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md
---
Record the alert transport's measured field state — the config is now present AND read by the running daemon (notifier.enabled = True), aiohttp is in the daemon venv, and the failure predicates fire; the POST itself is still unobserved and the box is 111 commits behind with the raising-harvest alert absent from the deployed capture.py.
