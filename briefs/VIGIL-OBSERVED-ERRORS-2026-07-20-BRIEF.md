<!--
  VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-20

_Field-observation record for `VIGIL-BLE-ROBUSTNESS-2026-07-19-BRIEF.md` and
`VIGIL-NIGHT-GUARDRAILS-2026-07-19-BRIEF.md`._

# Vigil observed errors — one night and one morning, watched live

**Out-of-suite (`capture-host/`, Python).** A running box was inspected continuously from **2026-07-19
21:35** to **2026-07-20 10:14** — a full 7.37 h night plus the idle morning after. This brief records
**only what was measured on the running system**, separates it from inference, and states each item's
current status. It proposes no code; it is the evidence other briefs execute against.

Two of the errors below were already fixed while the night was in flight; one has a fix sitting
**unmerged**; four are open.

## What was confirmed HEALTHY (so the failures below are read in context)

The decoders are correct, and the strongest evidence is that three independent chains agree on the same
physiology rather than any single value looking plausible:

| Chain | Derived HR |
|---|---|
| H10 raw ECG, peak count | 53–55 bpm |
| H10 device HR characteristic | 53 bpm |
| O2Ring PPG pulse rate | 53–55 bpm |

- **Sample rates match the negotiated rates** — ECG 129.94 Hz (130), H10 ACC 50.72 Hz (50), Verity PPG
  55.11 Hz (55), Verity MAG 20.53 Hz (20), O2Ring PPG 125.57 Hz (125.738).
- **Scale factors correct** — H10 ACC magnitude 997 mg against an expected 1000; ECG p2p 1040–1235 µV.
- **No intra-segment sample loss.** Largest inter-sample gap on every stream equals exactly **one sample
  period** (ECG 7.7 ms, Verity PPG 18.2 ms, O2Ring PPG 8.0 ms). Every loss below is a *session* boundary,
  never a dropped sample inside one.
- **Clock** — host disciplined to stratum-1 PPS throughout; device skew ≤ 0.25 s (H10 −0.03 s, Verity
  +0.02 s at 22:17).
- **Physiologically usable night** — SpO₂ median 96 %, min 78 %, only 0.5 % of samples < 90 % and 0.1 %
  < 88 %.

## Night yield — 21:35 → 04:57 (7.37 h)

| Stream | Coverage | Session files | Gaps > 60 s |
|---|---|---|---|
| Verity PPG / ACC / GYRO / MAG | **~100 %** | 10 | 1 (102 s) |
| H10 ECG / ACC | **96.8 %** | 11 | 2 (145 s, 100 s) |
| O2Ring PPG / SpO₂ / OXYFRAME | **87.8 %** | **115** | **10** (worst 245 s) |

## E1 · A live link carrying no data — **FIXED, merged**

At **21:36:31** the H10 connected and its PMD START was answered `already_streaming` (0x06). `is_started()
` reads that as live, so the streams were registered and the link held. **ECG and ACC produced zero rows
for 9.7 minutes** while HR/RR flowed normally — HR ran 21:36:37 → 21:45:51 and the first ECG sample of the
night is stamped **21:46:36**, after an unrelated reconnect re-ran the negotiation.

Only occurrence across every capture log on the box. Root-caused upstream (`polar-ble-sdk#287`) and fixed
by the **stall watchdog** in `11b7d05` (PR #280) — which correctly watches *bytes reaching a file* rather
than ACKs, since `already_streaming` is only one of several doors into the same silence.

**Status: merged to `main`, running in production since 06:04 — but still UNVALIDATED against a real
night.** The fix started at 04:55, after the night had ended, and the box has been idle since. Tonight is
its first real test.

## E2 · The daemon does not stop on SIGTERM — **fix exists, UNMERGED**

Reproduced live today. `SIGTERM` sent to PID 276382 at ~10:11:

- The handler **is** registered — `/proc/276382/status` `SigCgt` has bit 15 set.
- The signal **was** delivered and consumed — `SigPnd: 0`.
- **No `shutdown: stopping N task(s)` line was ever logged**, so the shutdown never progressed past entry.
- The H10 reconnect loop kept ticking (10:13:20) and capture files were still growing at **10:14:23**.
- `SIGINT` was equally ignored. **`SIGKILL` was required.**

A related, milder symptom is on record from the 05:50 shutdown runs: `vigil-shut.log` reaches
`shutdown: stopping 13 task(s)` and then `ERROR shutdown: web server did not close in 15s (an open
monitor/SSE client?) — abandoning it`, while `vigil-shut2/3.log` — after the fix — both reach a clean
`tepna-capture stopped`.

The fix is **`f43122b` on `claude/vigil-shutdown`** (*"let the daemon stop, reap the Muse child, bound the
ring's framing"*), 1 commit not in `origin/main`. It is written and demonstrated; it is simply not landed.

**This matters more than its severity suggests:** an unattended box that cannot be asked to stop can only
be killed, and a `SIGKILL` mid-night is exactly how a partial final file gets written.

## E3 · O2Ring reconnect storm — **OPEN, now the dominant loss**

The ring reconnected **178 times** in one night, fragmenting into **115 session files** and losing **12 %**
of the night across 10 gaps > 60 s (worst 245 s). Concentrated after ~01:37; the hourly pattern peaks
between 01:00 and 03:00.

Errors seen: `BleakError('failed to discover services, device disconnected')`,
`BleakDBusError('org.bluez.Error.Failed', 'br-connection-canceled')`, `org.bluez.Error.InProgress`. The
adapter watchdog logged **10 wedge signs** and performed **1 power-cycle** at 02:02:40 — after which the
link recovered. *The guardrail worked; the underlying churn did not stop.*

**The E1 stall watchdog does not address this.** Its failure mode is link churn, not stall — and the ring
runner deliberately watches *decoded frames rather than rows* precisely so an unworn ring is never torn
down. A fingerless ring emitting frames is the intended non-trigger, and that behaviour was observed
working correctly this morning. This needs its own brief.

## E4 · Nothing gates capture on wear state — **OPEN**

With the strap off and the ring on charge, the **Verity Sense streamed to disk for 4.16 h while sitting on
a desk** (RSSI −32, unworn), writing **453 MB** in a single session:

| Stream | Size | Share |
|---|---|---|
| ACC (416 Hz) | 323.1 MB | **71 %** |
| PPG | 59.0 MB | 13 % |
| GYRO | 50.4 MB | 11 % |
| MAG | 20.8 MB | 5 % |

The asymmetry that makes this hard to see: the O2Ring reports `worn: false` / `"no finger contact"` and the
H10 reports `worn`, but **the Verity reports `worn: null`** — the one device that cannot self-report is
also the one writing the most bytes. Nothing gates capture on wear state for any device.

Two independent levers: `rates: {acc: 52}` for the Verity is an ~8× reduction at no cost to MotionDex
(the same argument `capture.py` already makes in-line for H10 ACC at 200 Hz), and wear-gating is the
real fix.

## E5 · `LINK.csv` under-reports dropouts — **OPEN**

Between 22:14 and 22:16 the Verity re-subscribed twice and the H10 once — visible as new session files and
as `connected` lines in the log. **`LINK.csv` records `connected=1` across the entire window.** At a 25 s
poll interval it simply steps over drops of ~12 s. Under the pre-#282 code the *disconnect* was also never
logged at all — only the reconnect — so both surfaces under-count. #282 improved the connect-timeout text
but not the sampling.

Consequence: the LINK sidecar cannot be used as the authoritative dropout record. Session-file boundaries
can; that is what the coverage table above is built from.

## E6 · Disk trajectory with no acting guardrail — **OPEN (config, not code)**

Free space fell **21.31 → 19.71 GB** over the ~11 h observed (13.5 % → 12.5 %). The night cost ~1.9 GB;
the idle morning cost ~0.4 GB more. `config.yaml` sets **`keep_nights: 0`** (never prune) and carries **no
`alerts:` block**, so the storage guard and the webhook path from the guardrails brief are both inert — the
low-disk alert will fire to nobody and nothing will ever reclaim.

At the observed rate this is ~10 nights of headroom, and E4 consumes it faster than the nights do.

## E7 · Verity ACC/GYRO run ~2.2 % below nominal — **informational**

Measured 406.73 Hz against a nominal 416, and GYRO 50.83 Hz against 52 — the same 0.978 ratio on both.
Device sensor timestamps agree with the phone timestamps, so this is the Verity's real clock, not a decode
error. Harmless to anything deriving time from the timestamp columns; a 2.2 % timebase error for anything
that assumes nominal `fs`.

## E8 · Phone timestamps are non-monotonic — **informational, downstream contract**

Backward steps of up to **470 ms**: ECG 0.95 % of rows (worst 470 ms), Verity ACC 0.30 % (437 ms), O2Ring
PPG 0.13 % (194 ms). **Sensor timestamps are strictly monotonic** on every stream. This is batch-boundary
interpolation, matching the Polar Sensor Logger layout the suite already treats as first-class. Parsers
must order on the sensor column, or tolerate reordering, and must not assume the phone column sorts.

## Proposed next work — **status reconciled 2026-07-22 (all but one executed, shipped in v1.17.0)**

1. ~~**Merge `claude/vigil-shutdown`** (E2)~~ — **DONE.** Landed in **v1.17.0** ("let the daemon actually
   stop — an open monitor SSE stream blocked it; reap the Muse child, bound the ring frame").
2. **Validate the E1 fix across a real night** — **code in v1.17.0** (stall watchdog: "recover a BLE link
   that is up but carrying no data"); **real-night validation still OWED** and rides tonight's overnight
   (the box now runs under a `systemd --user` service, first uninterrupted test pending). The ONE open item.
3. ~~**A brief for the O2Ring link churn** (E3)~~ — **DONE.** `VIGIL-RECONNECT-BACKOFF-AND-LINK-COUNT` +
   `VIGIL-ADAPTER-FALSE-WEDGE` (v1.17.0): re-arm the reconnect backoff only after the link carries data;
   stop the adapter watchdog power-cycling the radio on one churny device while others stream.
4. ~~**Wear-gating + Verity ACC rate** (E4)~~ — **RESOLVED, with a finding:** the **ACC cap to 52 Hz**
   shipped (v1.17.0, kills the 453 MB/desk-night), but **motion wear-gating was REMOVED as disproven** —
   real worn-night data shows a worn ankle Verity reads ~1 mg |acc| std, *below* a desk, so no threshold
   separates worn from off-body (`VIGIL-WEAR-GATE-AND-ACC-CAP`). The onboard-.dat **O2Ring auto-pull**
   (`VIGIL-O2RING-AUTOPULL`) is the reliability backstop instead.
5. **Set `alerts.webhook_url` and a retention policy** (E6) — **retention DONE** (`keep_nights: 14` +
   `archive.enabled` live on the box, mirroring to a second disk — see `VIGIL-OFFLOAD-AND-RETENTION`);
   **`alerts.webhook_url` still `None`** on the reference box → the low-disk alert fires to nobody. Open.
6. ~~Raise `link.rssi_interval_sec` resolution or log disconnect edges (E5)~~ — **DONE.** LINK.csv now
   counts reconnect edges (`VIGIL-RECONNECT-BACKOFF-AND-LINK-COUNT`, v1.17.0).

## Field re-corroboration on the live box — 2026-07-22 (`rig-x870`, systemd service)
- **E8 CONFIRMED still present AND its downstream contract holds.** The current H10 ECG capture shows
  non-monotonic phone timestamps (backward steps in the first 5 k rows), yet ECGDex `compute()` produced a
  clean node-export (21 R-peak events) — because the ingest orders on the **sensor** column per E8's rule,
  not the phone column. The observation and its "parsers must not assume the phone column sorts" mandate
  are both verified true on new hardware data.
- **E6 disk pressure persists:** free space **17 GB of 158 GB (90 % used)**; `keep_nights: 14` +
  `archive.enabled` are set and `.archived` markers exist on 5 completed nights, so the retention/mirror
  half of E6 is live — but `alerts:` is still `None`, so item 5's alert half remains switched off.
