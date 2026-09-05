<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05-BRIEF.md
---
`tepna-update.sh` restarted the capture daemon whenever the deployed SHA moved — measured on vigil
2026-09-05 13:40:45, a restart to deploy `93a17e27`, a docs-only commit. The night interlock
protected no night (daytime), and the restart still dropped every live BLE link and re-ran bonding
for a process whose code had not changed by one byte, at a repo cadence of 28 merges/day
(audit brief C4).

The restart is now gated on CONTENT: owed iff the daemon's sha ≠ HEAD **and**
`git diff --name-only <running>..HEAD -- capture-host/` is non-empty (the brief's §6.3 rule
verbatim). A docs-only delta advances the deployed-SHA marker and skips the restart — in the timer's
`auto` mode, during a recording (no phantom debt for the morning tick to pay), and in the button's
`--no-restart` mode (no `RESTART-OWED` token). The gate fails TOWARD restart: a marker sha git
cannot resolve, or a failing diff, restarts exactly as before — it may only remove a restart it has
proven redundant. `--force-restart` bypasses it. The path filter is deliberately coarse: a
tests-only change under `capture-host/` still restarts.

After a docs-only deploy `/api/version` keeps reporting the sha the process started on, which will
read older than the checkout. That is `build_id.py`'s contract (what is RUNNING, probed once at
startup) and is correct — the daemon's code IS current.

Tests: `_advance` now touches `capture-host/` by default so every existing restart test goes through
the gate; nine new tests pin the docs-only skip, the coarse filter, the range-from-the-daemon's-sha
(a deferred code change followed by a docs merge is still owed), the fail-toward-restart on an
unresolvable sha (planted as a docs-only delta so the diff alone would say skip), and both button
modes. Three plants (skip on failure, widened filter, gate applied to `--force-restart`) each turn a
named test red.
