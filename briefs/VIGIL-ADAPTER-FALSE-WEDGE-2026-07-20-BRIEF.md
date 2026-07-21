<!--
  VIGIL-ADAPTER-FALSE-WEDGE-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-20 · **Created:** 2026-07-20

_A real wedge trace for the `classify_adapter_health` item deferred by `VIGIL-BLE-ROBUSTNESS-FOLLOWUPS-2026-07-20-BRIEF.md` and `VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md`._

# One churny device must not power-cycle the whole radio

**Out-of-suite (`capture-host/`, Python).** The adapter watchdog turned a harmless device-level BLE
hiccup into a **~25-minute self-inflicted capture outage** the first evening it ran with 4 devices.
Caught from the systemd journal. Test-first; capture-host pytest **100 %** on `capture.py`, **861 tests**.

## What was measured (the journal, 2026-07-20 19:39 → 20:17)

| time | event |
|---|---|
| 19:40–19:50 | H10 streaming ECG cleanly — **75,263 samples**. The adapter is working. |
| 19:52 | **first power-cycle** — watchdog declares a wedge |
| 19:52–20:10 | **8 power-cycles**, ~every 2 min, each dropping ALL 4 links |
| 20:12–20:16 | **5× "STILL wedged after 3 power-cycles — stopping auto-recovery"** (gave up) |
| 20:17 | **"healthy again" — one minute after the power-cycling stopped** |

**The only wedge signal was `Wellue O2Ring-S: InProgress` — 22 times.** The O2Ring reconnects
frequently (E3 churn); a reconnect that races another BLE op throws `org.bluez.Error.InProgress`. Nothing
else was flagged — no phantom link, no other device failing. And the recovery arrived *after* the
watchdog stopped, not from it: **the power-cycles were the outage, not the cure.** Each cycle dropped all
four links faster than four devices could re-establish through one USB dongle, so nothing could stream,
which looked like a persistent wedge, which drove the next cycle — a self-sustaining loop that only broke
when the give-up (`max_adapter_cycles`) halted it.

## Root cause

`classify_adapter_health` treated **any** device's `InProgress` as an "unambiguous adapter wedge." But
`InProgress` from **one** device while **others are connected and streaming** is *device-level*
contention — the adapter is demonstrably working (it is holding the other links). Reading it as an
*adapter* wedge triggers the most destructive recovery we have (a full-radio power-cycle) for a problem
the radio doesn't have. This is exactly the over-detection risk flagged when the item was first deferred
("loosening it risks trading under-detection for spurious power-cycles") — now with a definitive trace of
the **over**-detection.

## The fix

`InProgress` counts toward an adapter wedge **only when the radio is serving no one** (`not
any_connected`). If any device is connected, a lone `InProgress` is benign device contention and is not
flagged — so no power-cycle. The **phantom-link** signal (BlueZ `Connected: yes` while our daemon has no
link — a stale link nobody can re-grab) is **unchanged and independent**: it remains an unambiguous wedge
whether or not another device is live, because it is a real adapter-state problem.

This preserves real-wedge detection (the 2026-07-18 saga: all devices down + `InProgress` → still a
wedge) while removing the spurious case (a live link present → not a wedge). Pure function, so it is
tested directly in both directions.

## Done when — all met
- [x] `InProgress` while another device is connected → **not** wedged (no power-cycle). New test.
- [x] `InProgress` while no device is connected → **still** wedged (real-wedge case preserved). New test.
- [x] Phantom link → wedged regardless of other devices (unchanged). New test.
- [x] The prior `test_several_signals_are_all_reported` updated to the corrected semantics (it encoded
      the buggy behavior — InProgress flagged despite a live device).
- [x] capture-host pytest **100 %** on `capture.py`, **861 tests**; ruff clean.

## Not in scope / follow-up
- **Power-cycle cadence** — cycling every ~2 min does not give four devices time to re-establish before
  the next cycle, so the watchdog cannot tell if a cycle worked. A longer settle interval after a
  power-cycle (and/or fewer max cycles) would make even a *justified* recovery less disruptive. Separate
  from this root-cause fix, which prevents the spurious trigger entirely.
- **The O2Ring InProgress churn itself** is the E3 reconnect behaviour; the backoff fix (PR #298) reduces
  how often it reconnects, which reduces how often it can race into `InProgress`.
