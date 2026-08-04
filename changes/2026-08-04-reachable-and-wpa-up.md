<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04-BRIEF.md
---

capture-host: steps 2 and 3 of the subprocess-surface brief. `reachable()` decides whether the harvest
escalates to privileged Wi-Fi association at all, and `_wpa_up()` is that association — the only
privileged code in the harvest. Neither had anything asserting on the request or the commands issued,
so the probe's URL, method and accepted status range, and the association's file mode, deadlines and
interface name were all unobservable. 56 mutants, 33 aimed at and confirmed by ID; 3 more proven
equivalent and left alone.
