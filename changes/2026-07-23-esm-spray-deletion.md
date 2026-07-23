<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [HRVDex, PulseDex, OxyDex]
brief: ESM-MIGRATION-FOLLOWUPS-II-2026-07-16-BRIEF.md
---
Delete the bare-global back-compat spray from hrvdex/pulsedex/oxydex-dsp (FOLLOWUPS-II items 1-2): every realm is now namespaced — cohort-worker sets `__DEX_NAMESPACED__` and pulls parseCSV/processNight/rmssd/std from `<Node>._bare` explicitly (removing the old last-load-wins collision), the qrs workers already read off the namespace, and the test runner/app pages were already namespaced. Export-inert (the spray was a load-time side-effect, never in compute); only computeHash moved.
