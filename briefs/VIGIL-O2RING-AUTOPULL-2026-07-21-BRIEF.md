<!--
  VIGIL-O2RING-AUTOPULL-2026-07-21-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-21 · **Created:** 2026-07-21

_Follow-up of `VIGIL-RECONNECT-BACKOFF-AND-LINK-COUNT-2026-07-20-BRIEF.md` (E3) — the belt-and-suspenders
backup for a lossy live O2Ring link._

# Auto-pull the O2Ring's onboard `.dat` so a night's SpO₂ never depends on the live BLE link

**Out-of-suite (`capture-host/`, Python).** The night of 2026-07-20→21 exposed the real limit of live BLE
capture: with the box in another room, the O2Ring sat at **−85 dBm** and connect-stream-dropped **367×**,
yielding only **70 % live SpO₂ coverage**. The ring records the full night to its OWN flash regardless of
BLE — but that only helps if the `.dat` reaches the box, and pulling it was a manual step that (that night)
did not happen. This makes the pull automatic. Test-first; capture-host pytest **100 %** on `capture.py`
and `pull_session.py`, **870 tests**; `ruff --select E9,F` clean.

## What landed

### 1 · Idempotent pull — `pull_session._pull_once` skips what's on disk
`which="all"` re-lists every onboard session each call, so a repeat/auto pull previously re-downloaded the
**whole flash** over the slow BLE link every time. Now, after the device reports a session's `size`, a
`.dat` already on disk at that exact size is **skipped** (the device size is authoritative — same size =
same recording). Skipped sessions are NOT added to the returned `new_files`, so the return value is exactly
what this call actually wrote — which is what the poller keys on.

### 2 · `autopull_poller` — automatic, safe, drains the flash
Opt-in (`pull.auto`). On each interval it pulls `which="all"`, but only when it is genuinely safe:

- **Never interrupts a live capture** — it skips while the ring is *connected + worn* (actively streaming,
  e.g. asleep). It fires in the morning window once the ring comes off the finger.
- **Drains the FIFO flash** — the ring's memory is small and overwrites oldest-first, so a session missed on
  a lossy link is lost once new ones pile on. The poller **retries up to `auto_retries` (default 3)** per
  cycle, stopping early once a pass returns nothing new. Idempotency (§1) means a retry only re-fetches what
  an earlier attempt missed.
- **Best-effort** — an unreachable ring (raises) or a busy offline slot (`OfflineBusy`) is handled and
  retried next cycle; it never takes the daemon down. Reuses the bounded, connect-locked
  `pull_oxyii_session`, so it inherits the timeout + the "pauses live capture for the duration" contract.

### Config (deploy-only, off by default)
```yaml
pull:
  auto: false             # opt-in
  auto_interval_sec: 3600  # check hourly; only pulls while the ring is off the finger
  auto_retries: 3         # retries per cycle to drain the small FIFO flash
  ftype: 0
```

## Why this is the right shape for the range problem

E3 established the O2Ring churn is a **range** problem (−85 dBm, different room) that no backoff change
fixes — and worse, that the live coverage IS the SpO₂ record only *because* the `.dat` wasn't reaching the
box. Auto-pull inverts that: the onboard recording becomes the authoritative full-night SpO₂, landed
automatically, immune to BLE range. The live stream reverts to what it should be — the live monitor plus a
lossy redundant copy. **The remaining prerequisite is the ring's own recording** — on 2026-07-20 the ring
did NOT record the sleep to flash (only two short evening wear-sessions), so auto-pull had nothing to grab.
Arming/verifying the ring's onboard recording each night is an operator step this feature depends on.

## Done when — all met
- [x] Pull skips a session already on disk at the same size; not counted as new. Tested.
- [x] `autopull_poller` off by default; pulls only when the ring is off the finger; never interrupts a live
      worn capture. Tested.
- [x] Retries per cycle to drain the flash, stopping when a pass finds nothing new. Tested.
- [x] Unreachable ring / OfflineBusy handled without taking the poller down. Tested.
- [x] Supervised in `main()`'s background tasks; config in `config.example.yaml`.
- [x] capture-host pytest **100 %** on `capture.py`/`pull_session.py`, **870 tests**; ruff clean.

## Not in scope
- **The ring's onboard recording mode** — a device-side setting the box can't arm; the prerequisite above.
- **Range itself** — a closer/second dongle near the bed is still the real cure for the live churn (E3).
- Auto-pull does not delete from the ring (the ring manages its own FIFO); it ensures a copy lands before
  the ring overwrites.
