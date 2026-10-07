<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: none
---

Add four CI gates: PR body + changeset compliance (Rule 0 line, Fleet-Session trailer, corpus sentence on computeHash movers), absence-regression (diff-based, fails on new tMs/|| 0 fabrications), xss-sink-gate (diff-based, fails on new unescaped innerHTML sinks), docs-constants (CLAUDE.md numeric claims match code). The rebuild-consistency gate (#1) already existed via build.mjs --check.
