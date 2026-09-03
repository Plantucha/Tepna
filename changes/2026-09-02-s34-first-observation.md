<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
§3.4 records the first observation from the `selftest-all` instrument (#2093), and corrects the
paragraph that still named unbounded concurrency as the defect.

The instrument fired on its first real failure: `dsp-review-qwen` timed out at 120 s with load
**18.75 at sweep start** (24 cores) and **23.45 at the kill**, then passed **21 ok** standalone at
load 24.38. The box was already loaded before this session's sweep began, so the sweep did not cause
the load it died under — the signature the cross-session account predicts, and one no reasoning from
inside a single session could supply. The tool that died is the most expensive of the 81 (3.6 s), as
CPU demand predicts; a ≤0.30 s tool timing out would refute it. ONE observation, recorded as one.

Also corrected: §3.4 still called unbounded concurrency "the defect" and deferred a pool. The
uncensored measurement (6.3 s under induced load against a 120 s timeout) says that constraint was
never binding, so the pool was written and deliberately not shipped.
