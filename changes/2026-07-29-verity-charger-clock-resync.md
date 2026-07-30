<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The device clock is now re-synced on **every reconnect**, never while the device is on its charger, and a fresh sync retracts a previous `clock_uncorrectable` verdict.

**The bug, in three parts.** The sync ran *once*, ahead of `run_polar`'s reconnect loop, with the comment "Sync the device clock ONCE at task start". So:

1. **A device docked at task start never got a clock for the rest of the session** — however many times it reconnected. That is the common case, not a corner: the sensors sit on the dock all day and the daemon is already running when they come off. `clock auto-sync gave up — device stayed unreachable/busy` appears **21×** in one week of the box's journal.
2. **`clock_watchdog` kept re-syncing a *docked* device** on its 5-minute cadence. A docked Polar refuses PMD outright (`charging — PMD streams unavailable`, status `0x0D`) and will not take a PS-FTP clock write either, so the skew never moved, the give-up budget burned down, and the device was marked `clock_uncorrectable` for the session.
3. **The give-up was sticky across the very event that fixes it.** Coming off the dock and syncing cleanly did not clear it — `gave_up` is task-local to the watchdog and nothing could reach it.

**Observed 2026-07-29 on the box**, and it is the whole bug in one trace: Verity at **−5.0 s**, re-syncs logged at `05:01 / 05:06 / 05:12`, then `did NOT move after 3 re-syncs — accepting it as uncorrectable` at `05:17` — i.e. immediately after it went on the charger. It then stayed written off.

**The fix.**

- New pure predicate `clock_sync_due(is_polar, enabled, charging, first_attempt)`, consulted at the top of each reconnect iteration — **before `_connect`**, because the PS-FTP write needs the device's single BLE link and cannot run inside the connected session (it would await a pause only `run_polar` can grant).
- The 12-attempt retry body is extracted to `auto_sync_clock(name, addr) -> bool`, so the first sync and every re-sync are the *same* code rather than a copy. On success it clears `clock_uncorrectable` and publishes the address in `_CLOCK_FRESHLY_SYNCED`.
- `clock_watchdog` now **skips charging devices entirely** (before the re-sync decision, so the budget cannot burn) and **drains `_CLOCK_FRESHLY_SYNCED`**, discarding `gave_up`, resetting `failed_adrift`/`tried_adrift`, and re-baselining `seen` — the last matters or the corrected skew reads as a JUMP and triggers a redundant re-sync on the next cycle.

Skipping a docked device is not deferring the fix: **coming off the dock produces a reconnect**, which is exactly when the predicate returns `True`.

**Tests** — `tests/test_clock_resync_on_reconnect.py`, 13 assertions: the predicate's five branches (including `charging=None` ⇒ unknown must not block a sync) and its purity; that a successful sync retracts the verdict *and* publishes the address, with a **failure control** so the test cannot pass on a function that always reports OK; that `OfflineBusy` is waited out rather than surrendered to; and four wiring checks on the source — the call site exists, sits **before** `_connect`, the charging skip precedes `clock_resync_reason`, the watchdog drains the set and re-baselines `seen`, and the **pre-loop first sync still survives** (a regression guard on the fix itself: a device that never reconnects must still be synced).

Out-of-suite (`capture-host/`) — no bundle, no `manifestHash`, no fixture. `pytest` **1668 passed**.
