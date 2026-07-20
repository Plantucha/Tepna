<!--
  VIGIL-BLE-ROBUSTNESS-2026-07-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-19 · **Created:** 2026-07-19

_Follow-up of `VIGIL-NIGHT-GUARDRAILS-FOLLOWUPS-2026-07-19-BRIEF.md`._

# Vigil BLE robustness — the box recovers itself instead of holding a dead link till morning

**Out-of-suite (`capture-host/`, Python).** The night guardrails answered *"is the box alive, does it have
disk, did the night come out complete?"*. They did not answer **"is this live link actually carrying
data?"** — and they could not *act* on the answer. This brief closes that: every BLE await is bounded,
every long-lived task is supervised, and a stream that goes silent behind a healthy link is torn down and
re-negotiated instead of ridden out until dawn. Landed test-first; capture-host pytest stays at **100 %
coverage** (1179 statements in `capture.py`, **835 tests**); `ruff --select E9,F` clean.

## Why — a real, observed loss

At 21:36 on 2026-07-19 the H10 connected and its PMD START was answered **`already_streaming` (0x06)**.
`is_started()` correctly reads that as live, so the daemon registered the streams and held the link. **ECG
and ACC then sat at ZERO ROWS for ten minutes** while HR/RR flowed normally and the monitor showed the
device green. The hold loop ran on `client.is_connected` alone, so it had no reason to end. A manual
`bluetoothctl disconnect` fixed it instantly — the reconnect re-ran the negotiation against a device that
had just freed the stream.

The root cause is documented upstream (`polarofficial/polar-ble-sdk#287`): **the H10 serves ONE PMD stream
and does not release it when a client dies without a clean disconnect.** The stream stays owned by the dead
subscriber; a new START is acknowledged and delivers nothing. Every dev-cycle daemon kill reproduces it.

`already_streaming` turned out to be only one door into that failure. **The same silence** is produced by a
notification handler that keeps raising (bleak swallows it), a firmware that stops mid-night, a writer
failing on a full disk, and a dropped control indication. So the guard watches **bytes, not ACKs**.

Three further defects of the same class were found by audit and are fixed here — each one leaves the daemon
*running* while it captures nothing, which is why `Restart=always` never fires.

## What landed

### 1 · Stream stall watchdog — the keystone
`stream_is_stalled()` (pure, tested) + the hold loops in `run_polar`, `run_oxyii`, `run_viatom`.
Every started stream is watched for **bytes actually reaching a file**; after `_STREAM_STALL_S` (90 s) of
total silence the session is **ended**, which makes the device drop its link and free the stream, and the
reconnect re-runs the whole STOP → settings → START negotiation. That is the manual fix, automated.
- The ring watches **decoded frames, not rows** — vitals legitimately stop the moment it leaves the finger
  while frames keep arriving, so a row-based guard would tear down a healthy link every time it came off.
  Pinned by a counter-test (`test_run_oxyii_unworn_ring_is_not_torn_down`).
- 90 s is deliberately generous: the slowest stream we start (MAG at 20 Hz) delivers many rows a second.

### 2 · `already_streaming` is challenged, not trusted
A 0x06 ACK now forces a **STOP + re-START** and demands the stream for *this* subscriber. The pre-existing
unconditional STOP could not do it: **its ack was never read**. If the device still says 0x06, the stall
watchdog is the backstop.

### 3 · No answer is not a rejection (`pmd.NO_ACK`)
A control-point timeout used to fall into the "unsupported settings" branch: the writer was deleted and the
card unregistered, so **one dropped indication cost that stream the entire session** — and a control channel
that failed to subscribe silently cost *all* of them while HR carried on. Now kept and re-negotiated. The
`control indications unavailable` log moved from `info` to `warning`; it means the session is degraded.

### 4 · Every BLE await is bounded
`_connect`/`_connect_scan` held the **process-global** `_CONNECT_LOCK` across an unbounded `client.connect()`
— one wedged connect on any device froze every other device task, every offline op, and (because they skip
while paused) all three watchdogs, for the night. Also bounded: `_safe_disconnect`, the PMD control write,
`PolarPsFtp.__aexit__` (whose unbounded teardown ran *inside* the caller's cancellation, so `wait_for` could
never return), the `_CONNECT_LOCK` acquire in `polar_offline_op` (previously *outside* the timeout, making it
structurally unable to fire), and `pull_oxyii_session`, which had **no timeout and no connect lock at all** —
a ring carried out of range left `_OXYII_PAUSE` set for the night, disabling the very recovery ladder.

### 5 · Supervised tasks — `keep_running()` / `supervise()`
`main()` fires every task with `create_task` and does not gather until `_STOP`, so an escaping exception
retired that task **silently** — the traceback is never even retrieved (the `tasks` list holds the
reference, so asyncio's un-retrieved warning never fires). Reachable: `run_polar` does real work outside its
inner try (`night_dir()` per iteration → a full disk or read-only mount); `adapter_watchdog`'s power-cycle
calls `_btctl` under a bare try/finally; `rssi_poller` writes outside any try. Now every device runner and
every background poller restarts with a capped backoff, surfaces on the device card, and pushes an alert.

### 6 · Clock re-sync now converges — **LATENT, not observed at scale (corrected 2026-07-20)**
`clock_watchdog`'s `adrift` trigger fires on **absolute** skew, and the post-sync `seen.pop()` erases the
memory of having tried. For a skew that is constant and non-zero — an offset that cannot be shifted from
here, e.g. the Verity stamping PMD samples ~4 h ahead (measured 2026-07-18) — that pair cannot converge:
every cycle re-triggers, and each attempt pauses live capture and holds the connect lock for up to 45 s.
`clock_resync_reason()` (pure, tested) now gives up after `CLOCK_ADRIFT_GIVEUP` (3) proven-useless
attempts, says so **once**, and sets `clock_uncorrectable` in `status.json` — while a genuine **jump**
still re-syncs however often we gave up on the steady offset.

> **Correction.** This section originally claimed the loop was "observed live in `vigil-run.log`" and cost
> "~15 % of every night". **That was wrong** — inference from the first eight minutes of a session, stated
> as evidence. The full 7 h night of 2026-07-19 → 07-20 shows the adrift trigger firing **exactly once**
> (04:25:32, Verity, **−3.0 s** — a small drift just over the 2.0 s tolerance, not an uncorrectable one)
> and **converging**. It does not repeat, because `clock_skew_sec` is only set when a PMD frame carries a
> readable device time, and an unreadable clock leaves it `None`, which `continue`s. So the defect is real
> **in the logic** and the guard is cheap and correct, but it is **latent** — it has not been shown to
> cost a night. The 10 offline-op pauses clustered in 21:35–21:43 that prompted the original claim are a
> **different path**: the startup clock-sync ladder retrying (see the follow-up on its ~14 min worst case,
> which those 10 pauses in 8 minutes *do* corroborate).

### 7 · Ring/legacy paths brought up to the Polar path's standard
`run_oxyii` and `run_viatom` never deleted **header-only files** (on the documented 359-reconnect night that
is ~1000 junk files in one night dir, each indistinguishable from a real capture until opened).
`run_viatom` additionally ignored `_RECOVER`/`_OXYII_PAUSE` — the only runner that did — so it hammered
connects at a radio the watchdog was powering off, and silently skipped `START_CMD` when no write
characteristic was found (guaranteeing a dead night with a live link and no error). All fixed.

## Done when — all met
- [x] Stall watchdog on all three runners; unworn ring and delivering streams provably NOT torn down.
- [x] `already_streaming` forces STOP + re-START; `NO_ACK` keeps the stream; real rejections still drop it.
- [x] Every BLE await bounded; `_CONNECT_LOCK` never held across an unbounded operation.
- [x] All runners + pollers supervised with capped backoff, status surfacing, and an alert.
- [x] Clock re-sync converges and reports an uncorrectable offset once.
- [x] capture-host pytest **100 % coverage**, **835 tests**; `ruff --select E9,F` clean.

## Not in scope (candidate follow-ups)
- **`sd_watchdog` measures the wrong liveness.** Its docstring promises detection of a hung-but-alive
  daemon, but every failure above leaves the event loop healthy — tasks merely await — so `WATCHDOG=1`
  keeps firing and systemd stays satisfied. It proves the loop turns, not that anything is being captured.
  A capture-liveness heartbeat (gate the ping on any device's `rows_*`/`last_sample` advancing) would make
  it mean what it claims.
- **`classify_adapter_health` under-detects.** `le-connection-abort-by-local`, repeated connect timeouts on
  a strap that reports itself **worn**, and a hung connect (`last_error` cleared, `connected` False) all
  read as benign; `worn` is tracked but never passed to the classifier. **Deliberately left alone here** —
  it drives the most disruptive recovery we have (an adapter power-cycle), and loosening it risks trading
  under-detection for spurious power-cycles mid-night. Wants its own brief with real wedge traces.
- **`run_muse`**: sets `connected=True` *before* the child exists and never inspects `returncode`, so a
  child that exits immediately respawns every 5 s all night behind a green status card; on shutdown
  `CancelledError` skips `terminate()`, orphaning `muselsl` holding the Muse's BLE link so the next daemon
  start cannot connect.
- **`pull_session`** internals (connect/`start_notify`/chunk writes) are individually unbounded; only the
  whole-op timeout added here bounds them.
- **`oxyii.Reassembler`** accepts any length up to 65535 — a truncated notification can swallow ~64 KB of
  valid following frames. A `ln <= 512` guard would bound it.
- **Startup clock-sync ladder** is ~14 min worst case (12 × 45 s + backoff sleeps), during which capture is
  paused ~65 % of the time and cannot self-recover.
- **Audit note:** the "stale `_WORN_SINCE` gives a re-worn strap a zero-length grace" finding was checked
  and is **by design** — the short probe is what the code comment describes, and a `contact=True` frame
  clears it. Not changed.
