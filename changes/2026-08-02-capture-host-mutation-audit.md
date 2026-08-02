<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
Mutation-audit capture-host, and gate the diff on it.

`capture-host/` has been at 100% statement+branch coverage since 2026-07-27, enforced at
`--cov-fail-under=100`, and had never been mutation-audited — the gap TEST-AUDIT-FINDINGS §34 recorded.
Coverage asks "was this line executed?"; mutation asks "would any test NOTICE if it were wrong?", and on
this tree the answer is that a quarter to a half of mutations are invisible. 24 of 25 modules measured
with unmodified mutmut 3.7; worst is `pull_session.py` at 47% (242 survivors), the O2Ring `.dat` puller
that exists because the live BLE link is lossy. Findings in
`audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md`, with the caveat that raw rates overstate the gap — 29 of
33 survivors on `capture._now` were log-message wording. Four confirmed leads fixed test-first,
including a low-disk flag whose PRODUCTION configuration no test covered (`and`→`or` makes the alert
fire on every poll forever) and the Notifier's fail-safe `enabled=False` default, which nothing pinned.
Adds `tools/mutate.py` (the audit, never a gate) and `tools/mutate_diff.py` wired as a `mutation-diff`
CI job that mutates only the functions a PR touched — the one form that can be required without redding
on untestable survivors.
