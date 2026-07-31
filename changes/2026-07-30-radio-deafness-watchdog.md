<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
The watchdog now checks whether the radio can still **hear**, and restarts bluetoothd when it cannot. `UP RUNNING` was never the same thing as receiving.

## The night

2026-07-30. `hci0` reported `UP RUNNING` with 332 MB of lifetime traffic. All three sensors — H10, Verity, O2Ring — failed to connect with plain `TimeoutError`. `classify_adapter_health` looked at that and said **not wedged**, which was *correct by its own rules* and wrong about the world: clean timeouts on an up adapter are precisely what "nobody is wearing them" looks like, and that is the one state a watchdog must never power-cycle on. So the recovery ladder sat idle and the box captured nothing.

The signal none of the existing checks carried: a 20 s scan saw **0 advertisements**, in a house with dozens. The receiver was not receiving. `systemctl restart bluetooth` took it from **0 to 91 devices**, and all three sensors reconnected.

## The check

`radio_looks_deaf(seen, connected_any, consecutive_silent, min_silent_rounds=2)`, probed from the **not-wedged** branch of `adapter_watchdog` — the branch that previously just logged "adapter healthy again" and continued, because that is where the failure was misfiled. Three guards keep it from becoming the flaky thing:

- **Only when nothing is connected.** A live link is proof the radio works, whatever a scan says, and it is also the only state in which probing would contend with the daemon's own connects.
- **Two consecutive silent rounds.** A single scan can lose the race for the controller or land in a genuinely quiet moment.
- **A probe that threw is not silence.** It reports `n_seen = -1`, which is evidence about the *probe*, not the radio. Counting a flaky `bluetoothctl` as deafness would let it power-cycle the stack all night.

Hearing *anything* clears the counter. Our sensors being off is not deafness — that distinction is the whole design, and it has its own inverse-control test, because without it this change is a watchdog that restarts bluetooth every minute forever.

## The grant

`tepna-restart.sh` gains a `radio` verb (`systemctl restart bluetooth`, then re-checks `is-active` and exits non-zero if it did not come back, same discipline as `restart`). **No new sudoers rule** — the existing grant from `enable-restart-control.sh` names the file, not the verb.

That is worth stating plainly rather than burying: adding a verb to a NOPASSWD-granted script **widens** what `vigil` can do without a password, from "restart the capture daemon" to "restart the capture daemon *or* bluetoothd". Deliberate and small — one more named unit, still no general `systemctl` — but a grant that names a file is a grant on everything that file will ever do, so every future verb is a security edit and should be reviewed as one.

**Deploy note:** the granted helper is a root-owned *copy* under `/usr/local/lib/tepna`. Until `sudo bash deploy/enable-restart-control.sh` is re-run, the deployed copy does not know `radio` and will exit 2 — which the watchdog reports honestly as a failed restart, but it will not recover anything.

## Verification

19 tests. The predicate is unit-tested on all five states, and the recovery is also driven **end to end through the real `adapter_watchdog`** in the exact shape of the night (adapter UP, one worn sensor timing out, classifier saying not-wedged) — a predicate nothing reaches saves nobody. Both `_run_helper` failure paths are exercised against real processes rather than mocks: a hanging helper returns 124 rather than wedging the watchdog task (`systemctl restart bluetooth` can hang precisely on the wedged controller this runs against), and an unresolvable helper degrades to "cannot restart" instead of throwing out of `adapter_watchdog` and taking every *other* recovery rung with it.

Gates: capture-host **1714 passed**, 100 % statement+branch coverage held · `ruff` clean. No bundle touched — capture-host is Python and the helper is shell.
