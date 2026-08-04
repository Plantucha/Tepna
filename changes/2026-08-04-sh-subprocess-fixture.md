<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04-BRIEF.md
---

capture-host: a recording `subprocess.run` double in `conftest.py`, and `cpap_harvest._sh` tested
through it. `_sh` is the single point through which all nine privileged commands in the harvest reach
the system, and nothing asserted on the CALL — so its sudo prefix, all four `subprocess.run` arguments
and the merge of stdout+stderr were unobservable. 29 mutants, 15 aimed at and confirmed by ID.
