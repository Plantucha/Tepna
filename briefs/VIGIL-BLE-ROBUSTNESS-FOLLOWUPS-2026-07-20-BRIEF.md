<!--
  VIGIL-BLE-ROBUSTNESS-FOLLOWUPS-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-20 · **Created:** 2026-07-20

_Follow-up of `VIGIL-BLE-ROBUSTNESS-2026-07-19-BRIEF.md`._

# Vigil follow-ups — the box can be restarted, the Muse child is reaped, and the ring's framing is bounded

**Out-of-suite (`capture-host/`, Python).** Executes three of the parent's open items, all found by
**running the daemon and measuring it** rather than by reading it. Test-first; capture-host pytest stays at
**100 % coverage** (`capture.py`, `oxyii.py`, `webmon.py` all 100 %), **850 tests**; `ruff --select E9,F`
clean.

## 1 · The daemon could not be stopped — and it was never a BLE problem

**Measured 2026-07-20:** `SIGTERM` left the daemon alive past **101 s** with nothing in the log, on the
merged post-#280 code. Under systemd that is a `systemctl restart` that hangs to `TimeoutStopSec` and is
then `SIGKILL`ed mid-write — the opposite of set-and-forget.

> **Correction to the record.** When this first appeared, it was attributed to "the documented BLE shutdown
> wedge (`capture.py:1094`, *SIGTERM could not even cancel it*)". **That was wrong**, and it was asserted
> before it was measured. Bounding each shutdown phase and naming the offender produced the real answer on
> the first run: `gather()` completed **cleanly** — the BLE tasks were never involved — and
> `AppRunner.cleanup()` was the phase that never returned.

The cause is `webmon.stream`: the monitor's SSE live-view is a `while True` that ends only when the
**client** goes away, and `AppRunner.cleanup()` waits for in-flight requests. So an open browser tab
blocked the restart, indefinitely. Fixed at the source, with a backstop:

- **`webmon`** registers an `on_shutdown` hook — aiohttp fires it *before* it waits — which sets a flag
  **and pushes a sentinel to every open stream**. The flag alone is not enough: the handler is parked in
  `q.get()` and would not look at it for a further keep-alive period.
- **`capture.main`** bounds each shutdown phase (`_SHUTDOWN_PHASE_S`, 15 s) and, when a phase overruns,
  **names** what refused to stop (`TASK_LABELS`) instead of hanging silently. It uses `asyncio.wait`, not
  `wait_for(gather(...))` — on timeout `wait` *reports* what is still pending, whereas `wait_for` cancels
  the gather, which cancels the children a second time, so by the time the handler looked the stuck tasks
  had finished and it named nothing. (Caught by the test, not by review.)

**Verified live, with a real SSE client attached** (376 bytes received, so the stream was genuinely open):
**exit in 2 s**, `cleanup()` completing normally rather than being abandoned. Before: >101 s, never.

## 2 · The Muse child is always reaped — `run_muse`
`CancelledError` is a `BaseException`, so on shutdown neither `except` clause ran and `terminate()` was
skipped **entirely**, orphaning `muselsl` still holding the Muse's BLE link — so the *next* daemon start
could not connect to it. Teardown now lives in a `finally` (which runs on cancellation), waits for the
child so it can flush its CSV tail, and escalates to `kill()` if it ignores `SIGTERM`. Separately,
`connected=True` was being set **before** `create_subprocess_exec`, so a tool that died on its first line
— device off, bad address, no LSL stream — showed a **green card all night** while the loop respawned it
every 5 s; `alert_poller` keys on `connected`, so nothing ever fired. It is now set after the child
exists, and a non-zero exit is reported as a fault.

## 3 · The ring's reassembler bounds a declared length — `oxyii.Reassembler`
`ln` is 16-bit, so a mis-framed or truncated notification could claim up to 65535 and park the reassembler
waiting for bytes that never come, swallowing every **valid** frame that followed (~64 KB ≈ 7 min of data)
until the link happened to drop. An implausible length now means loss of sync: drop the lead byte and
resync on the next `0xA5`. `MAX_FRAME_LEN` is deliberately **loose (2048)**, not tight — a bound set near
today's ATT MTU (247 measured) would break the `.dat` transfer outright if a firmware ever negotiated the
517 MTU, and 2048 still caps the damage at ~2 KB. Pinned by a test that a large-but-plausible chunk still
reassembles, precisely so the bound cannot silently regress the stored-session pull.

## 4 · O2Ring RTC — investigated, measured HEALTHY, deliberately NOT changed
Checked against the real stored session pulled 2026-07-20 (`Wellue_O2Ring-S_20260719194857_STORED.dat`):

| | |
|---|---|
| device-stamped session start (its own RTC) | `2026-07-19 19:48:57` |
| samples in the `.dat` | 32 941 @ 1 Hz = **9 h 09 m 01 s** |
| ⇒ implied end | `2026-07-20 04:57:58` |
| daemon observed the session end (host, NTP-synced) | `04:58:00` |
| **discrepancy** | **2 s** |

Decisively: that session began at 19:48:57 and the daemon's first RTC sync was at **21:35:30**, an hour
and 47 minutes *later* — so the ring stamped the header with its own free-running clock, unaided, and was
still within 2 s after nine hours. **This contradicts the `oxyii.py` note claiming it "drifts ~+151 s
(measured 2026-07-17)"**, at least for this unit over this period. Owner decision: **keep the RTC logic as
is.** Recorded here so the next reader does not "fix" a clock that is accurate to 2 s.

One real logic flaw is documented but **left alone** by the same decision: the `new recording session` RTC
sync fires ~1 s *after* the session has already started (`04:58:00` detected → `04:58:01` synced), and the
`.dat` header is stamped at session start — so that write cannot fix the stamp it exists to protect; it
only helps the *next* session. What actually protects a session's stamp is first-contact plus the drift
backstop. Also minor: `first contact` is remembered per **process**, so every daemon restart re-writes the
clock (seen twice on 2026-07-20).

## Done when — all met
- [x] Shutdown terminates and names what refused to stop; verified live at **2 s** with an SSE client open.
- [x] SSE streams end on `on_shutdown` so `cleanup()` completes rather than being abandoned.
- [x] Muse child reaped on cancellation (terminate → wait → kill); non-zero exit reported, card not green.
- [x] Reassembler rejects an implausible declared length and resyncs; large plausible frames still pass.
- [x] capture-host pytest **100 %** on `capture.py`/`oxyii.py`/`webmon.py`, **850 tests**; ruff clean.

## Not in scope (still open)
- **`sd_watchdog` measures the wrong liveness** — it proves the event loop turns, not that anything is
  being captured. Deliberately still open: gating the heartbeat on capture progress would restart the box
  whenever the sensors are legitimately off (as they were all of 2026-07-20 morning), so it needs a
  worn/expected-to-be-capturing signal first, not just `rows_*`.
- **`classify_adapter_health` under-detects** (`le-connection-abort-by-local`, connect timeouts on a strap
  reporting itself **worn**, a hung connect). Still deliberately untouched: it drives the adapter
  power-cycle, the most disruptive recovery we have, and the 7 h night of 2026-07-19 shows it already
  firing (10 wedge signs, 10 phantom clears, **1 power-cycle at 02:02:40**). Loosening it without real
  wedge traces risks trading under-detection for spurious mid-night power-cycles.
- **`pull_session` internals** (connect / `start_notify` / chunk writes) are individually unbounded; only
  the whole-op timeout from #280 bounds them.
- **Startup clock-sync ladder** ~14 min worst case. Corroborated by the night: **10 offline-op pauses
  clustered in 21:35–21:43**, which is the ladder retrying, not the drift watchdog.
- **O2Ring reconnect churn** — 59 link errors in 7 h (42 `BleakError`, 13 `BleakDBusError`, 4
  `BleakGATTProtocolError`), consistent with the documented 359-reconnect night. Tolerated rather than
  reported; the strongest remaining lead.
