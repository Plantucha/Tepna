<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
`check-system-files.sh` — install the privileged helpers **executable**, and stop printing "in sync" for a file the same run counts as drift.

**1 — #914 made four executable root helpers MANAGED while both install sites still forced `install -m 0644`.** `tepna-clock.sh`, `tepna-restart.sh`, `tepna-rssi.sh` and `tepna-usbreset.sh` are reached as `sudo -n /usr/local/lib/tepna/<x>.sh …` under scoped NOPASSWD grants. A 0644 copy is not untidy, it is **unrunnable**: every one of those grants breaks, including `tepna-restart.sh` — the one thing that lets a deploy finish itself without an interactive password, and the fix for the four-day stale-daemon event that prompted #914 in the first place.

That made `--install` **strictly worse than the drift it repairs**, and it was newly reachable: before #914 these files were unmanaged, so `--install` never touched them. The mode is now per-file manifest data (a fourth column, defaulting to `0644`) and both sites use `install -D -m "$mode"`. It is deliberately data and not a second hardcoded constant — flipping the global to `0755` would fix the helpers by making three `/etc` config files world-executable, and a unit file is not a program.

**2 — the report contradicted its own summary.** An AMBIGUOUS source increments `drift` and makes the script exit 1, but the table still printed `✓ in sync` for that file. On the live box this read as *"3 managed, 1 drifted, 1 AMBIGUOUS"* with **every row green and nothing to point at** — the one honest signal on an appliance you cannot look over the shoulder of, made unreadable. The row now says `✓ content in sync ⚠ ambiguous source`: the bytes matching is a narrower claim than the file being fine, and it now says exactly that much.

Three tests in `test_deploy_sync_apps.py`, each mutation-verified to fail against exactly the defect it names: restoring `install -m 0644` fails the executable test, collapsing the mode to a global `0755` fails the per-file test, and restoring the bare `"✓ in sync"` fails the contradiction test.
