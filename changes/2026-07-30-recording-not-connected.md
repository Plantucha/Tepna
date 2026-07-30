<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The offline alert now fires on **data**, not on a link — and a lost BlueZ bond is **retried** instead of being terminal.

**What happened, 2026-07-29.** The H10's bond went stale at 22:57. `ensure_bonded`'s re-pair removed it and could not re-establish it, leaving BlueZ at `Paired: no`. From **23:48** the task connected and was torn down every ~70 s — for **four and a half hours** — writing nothing. The Verity and O2Ring recorded all night; the ECG leg is simply missing. Two independent defects turned a bond glitch into a lost night.

**1 · The alert reported the outage as resolved, four times.** It keyed on `connected`, which is momentarily TRUE inside every doomed connect→drop cycle:

```
23:54 offline → 00:18 RECONNECTED → 00:24 offline → 00:51 RECONNECTED
00:57 offline → 03:31 RECONNECTED → 03:37 offline → 03:42 RECONNECTED → 03:48 offline
```

Four "recovered" notices, and not one byte after 23:48. A total outage read as a series of resolved blips, so nobody looked. New pure `alerts.device_is_recording(connected, last_data_mono, now, grace_sec)` requires **flowing samples**; `capture.note_data(name, mono)` stamps arrival from the Polar aggregate-flow check and both O2Ring row paths. `data_stale_sec` (default 120) is comfortably longer than the 60 s poll so a healthy device never flickers, and far shorter than `offline_sec` so a silent link trips the SAME 5-minute alarm a disconnected one does. The message now also **names the failure** — `offline` vs `linked but recording nothing` — because those want different responses from the operator, and saying "offline" about a strap that is right there, connecting every 70 s, sends them looking for the wrong thing.

This is the lesson `cpap_harvest.blocking_devices` already learned one module over — *"a sensor on its charger reports connected=True while producing nothing"* — applied to the alert path, which never got it. Both are the house rule that **a silent zero is the thing to catch**.

**2 · Nothing ever tried to re-bond.** The bond ran once, ahead of the reconnect loop, on a comment that had held for a year: *"reconnects after a transient drop reuse the stored bond, so we don't re-bond in the loop"*. When the bond is **gone** rather than transiently dropped, that assumption makes the state terminal — there was no path back without a service restart. New pure `rebond_due(needs_pmd, bonded, iteration, attempts, every, limit)`, checked before `_connect` (pairing needs the device's own BLE link, the same constraint the clock write has). `_REBOND_EVERY = 5`, `_REBOND_LIMIT = 72` — one try every ~6 min for **7 h**, sized deliberately to span a whole night, since the 2026-07-29 loss would have needed a retry four hours in. `test_the_cap_still_spans_a_whole_night` pins that arithmetic, so shrinking either constant reds. The cheap conditions gate the expensive one: `is_bonded` shells out to `bluetoothctl`, so cadence and cap are settled by arithmetic before any subprocess runs.

**Not changed, and worth recording:** the SIG Heart Rate profile (the one gym equipment uses) is **already** subscribed at `capture.py:1169`, *before* PMD at `:1242`, so HR+RR is already a fallback that needs no bond. It did not help here because the link itself is torn down 1–2 s after connect, before anything can stream — a genuinely unauthenticated-but-alive link was never on offer.

**Tests** — `tests/test_recording_truth.py`, 22 assertions. The five `device_is_recording` branches including the exact night's state (connected, nothing ever arrived) and the inversion control (fresh bytes must not excuse a dropped link); that every stream path feeds the predicate, since one fed by nothing reports "not recording" forever and the alarm never clears; the four `rebond_due` conditions plus the night-spanning arithmetic; and four driven through the real `run_polar` — a lost bond IS force-re-paired, a healthy one is **not** (the control, without which the first passes on a runner that re-pairs unconditionally), a failed re-pair reaches the operator, and a raising bond check never takes the capture task down. Plus `test_alert_poller_does_NOT_call_a_silent_link_recovered` as the direct regression guard, and the existing recovery test updated to stamp data as the real paths do.

`note_data` takes the caller's clock reading rather than reading it: a wasted call on a per-second hot path, and it perturbed the stall tests, which drive a stateful fake clock that advances on every read.

Out-of-suite (`capture-host/`) — no bundle, no `manifestHash`, no fixture. `pytest` **1695 passed**, coverage **100.00 %** under CI's exact invocation, `ruff` clean.
