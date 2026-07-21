<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Fix a ReferenceError in OxyDex `profileDerivedUpdate`: DEEP-AUDIT-II #43 removed the shared `_elv`/`_adj` declarations along with the dead `pd_elev` disclosure, but a later `profileElevSub` line still referenced them — so the profile-derived update threw on every call. Declare them locally at the surviving use site (regression hotfix; the load error was swallowed as an optional-module warning so CI stayed green).
