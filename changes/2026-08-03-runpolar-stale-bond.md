<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
The stale-bond recovery is now gated — and the fixture that reaches it came from `pull_session`, not from `run_polar`.

A device-side factory reset leaves BlueZ reporting `Bonded: yes` while the sensor has forgotten us.
`ensure_bonded` then short-circuits forever and the strap drops service discovery on every reconnect —
the 2026-07-29 loss: 4.5 h of ECG, reconnecting every ~70 s, with no path to recovery. The recovery
counts CONSECUTIVE failures and fires at two, because one is also what ordinary flapping looks like and
a forced re-pair costs ~20 s of scripted bluetoothctl. All three guards were unasserted.

`stale_bond_hits` is a LOCAL counted across LOOP ITERATIONS, so reaching it needs several reconnects
inside ONE `run_polar` call. Two earlier attempts failed by modelling the fixture on `run_viatom`'s
raising-`services` client — `run_polar` never iterates them. The working shape is to inject at
`_connect`, because the handler wraps the whole `async with _connect(addr) as client:` block, and that
pattern was already in `test_pull_session.py`. Looking at a different runner is what found it.

Also recorded in the fixture: an infinite async runner with a patched `sleep` that never trips `_STOP`
hangs the suite outright, so the counter is capped as well as filtered.

Negative-controlled both ways: `>= 2` → `>= 1` reds the one-hit test; dropping the counter reset reds
the consecutive test.
