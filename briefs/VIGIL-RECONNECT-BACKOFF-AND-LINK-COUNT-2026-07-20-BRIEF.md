<!--
  VIGIL-RECONNECT-BACKOFF-AND-LINK-COUNT-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-20 · **Created:** 2026-07-20

_Executes E3 (O2Ring reconnect storm) and E5 (LINK.csv under-reports dropouts) of
`VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md`._

# The reconnect backoff actually backs off, and the LINK sidecar can't miss a dropout

**Out-of-suite (`capture-host/`, Python).** Two field-observed defects, both the same root class as the E1
stall bug: **"connected" is not the same as "working."** Test-first; capture-host pytest **100 %** on
`capture.py` and `writers.py`, **866 tests**; `ruff --select E9,F` clean.

## E3 · The O2Ring reconnect storm — the backoff never backed off

VIGIL-OBSERVED-ERRORS measured **178 reconnects in one 7.37 h night**, fragmenting into **115 session
files** and losing 12 % of the night. Mining the log for the mechanism: the dominant error is `failed to
discover services, device disconnected` (**38×**) — the ring's connect SUCCEEDS, then it drops during GATT
service discovery, ~1–2 s later. And the reconnects were **evenly spaced at a ~21 s median**, not the
exponential backoff you would expect from a failing link.

The cause is a one-liner: `run_oxyii` reset `backoff = 5` **the instant `_connect_scan` yielded a client** —
i.e. on bare connect, before the session proved it could stream. Because the failure mode is
connect-then-drop, that reset fired on *every doomed attempt*, so the backoff never grew: 15 s scan +
connect + 5 s sleep ≈ the observed 21 s, forever. Exactly the E1 lesson — a bare connect is not a viable
session — in the reconnect loop.

**Fix:** reset the backoff **only when data actually flows** (the poll loop's "frames advanced" branch). A
ring that connects-and-drops without a single frame now backs off 5 → 10 → … → 60; a ring that genuinely
streams resets to 5 and so recovers fast from a later transient drop.

**What this does and does NOT fix (stated plainly).** The *root cause* of the drop-during-discovery is
signal/hardware (the observed storm concentrated 01:00–03:00, consistent with the documented weak-link
nights) and is **not addressable in this code**. What the fix removes is the self-inflicted **churn**: far
fewer doomed reconnects, so fewer fragmented session files, less BLE adapter contention (which the watchdog
was reading as wedge signs — 10 in the night), less battery, less log spam. **Data yield during a flapping
spell is unchanged** — those 21 s retries were capturing nothing anyway. The one honest cost: after signal
recovers, the next retry may be up to 60 s out instead of ~21 s; but the header-only cleanup already
discards the empty sessions the old churn produced, and the first successful reconnect resets the backoff.

## E5 · LINK.csv under-reported dropouts — count the edge at the source

`rssi_poller` samples `connected` every ~25 s, so a drop+reconnect **inside** a 25 s window is invisible —
it reads `connected=1` at both ends (measured: the Verity re-subscribed twice and the H10 once in a
22:14–22:16 window the sidecar logged as connected throughout). The sidecar therefore could not be trusted
as a dropout record.

**Fix:** the runners already know every edge exactly — each calls `_set(connected=True/False)` the instant
the link flips. So `_set` now **counts the False→True transitions** into a per-device `link_epoch`, written
as a new (appended-last) LINK.csv column. A reconnect the 25 s poll sampled over still bumps the count, so
**if `link_epoch` jumps between two rows, dropouts happened** — even when both rows read `connected=1`. The
sidecar becomes authoritative for the *number* of dropouts (exact edge *timestamps* remain available from
the session-file boundaries, which is what the coverage tables are already built from).

Column is appended last, preserving the positional contract for any reader of the first seven columns —
the same discipline `LinkLogWriter`'s docstring already keeps.

## Done when — all met
- [x] O2Ring backoff resets only on a viable (data-flowing) session; connect-then-drop backs off 5→10→…→60.
- [x] A viable session still resets fast (verified: a streaming ring runs the data path).
- [x] `_set` counts reconnect edges into `link_epoch`; a drop the poller missed is still counted.
- [x] `link_epoch` written to LINK.csv, appended last; absent value blank (never a fabricated 0).
- [x] capture-host pytest **100 %** on `capture.py`/`writers.py`, **866 tests**; ruff clean.

## Not in scope
- **The root cause of the discovery-drop** (signal/hardware). This reduces churn, not the underlying link
  failure; a signal-side investigation (antenna/placement/RSSI-gated behaviour) is a separate concern.
- **Exact per-edge timestamps in LINK.csv** — `link_epoch` gives the count; session-file boundaries already
  give the timing. An event-row schema could add exact stamps later if needed.
- E4 (wear-gate/ACC cap) and E6 (retention/offload) are in their own briefs.
