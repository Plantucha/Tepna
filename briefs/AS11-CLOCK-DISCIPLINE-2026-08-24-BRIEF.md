<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-09-01 (all three done-when boxes met; the RATE — the last open item — answered from the box's own week of sidecar data: **−4.7 ppm over 160 h**, see Measured · residue: per-EDF sidecar placement + ingest re-anchor live on as #1956's follow-ups, not here) · **Created:** 2026-08-24 · **Follows:** `AS11-SESSION-DETECTION-PROTOCOL-INVESTIGATION-2026-08-24-BRIEF.md`

# AS11 clock discipline — the device RTC watched against the box (a timeshift sidecar)

Executes the "device-clock discipline at ingest" reliability item from the investigation roadmap. The
AS11 RTC cannot be set over BLE (`SetDateTime` is service-access, no BLE VCID) and reads **~21 min
fast**; the live BLE→EDF capture stamps the EDF with that device clock and there is **no downstream
correction and no offset recorded** today (verified in `cpap_edf_writer.py` — "the box applies its
host-axis correction downstream" is aspirational; the CPAP path never reads `GetDateTime`). So a
capture is silently ~21 min off with nothing to re-anchor it. This closes that gap the host-axis way:
**measure and record, never set.** Out-of-suite (`capture-host/`); no bundle / provenance impact.

## What it answers (the owner's two questions)
A paired-clock **sidecar** (the RingClock idiom — one row per read, beside the capture, telemetry not a
metric) logs `(host_civil, device_civil)` anchors across a session. `as11_clock.analyze` reduces them to:
1. **Total offset** — `median(host − device)`, the ~21 min (device ahead ⇒ negative).
2. **Rate — "is a ResMed minute actually a minute?"** — the least-squares **slope** of offset(t):
   flat ⇒ a pure FIXED offset (a device minute is a real minute); sloped ⇒ the RTC crystal ticks
   off-rate, quantified in **ppm**. The device reads to the whole second, so the report includes a
   `ppm_floor = quantum/span` and only calls the minute "real" when |slope| sits under that floor —
   it refuses to quote a rate the second-resolution reads cannot support (the `defined-is-not-
   informative` discipline).

## Correctness invariants
- **READ-ONLY** — only `establish` + `get_date_time`; never `Set`/`Enter*`/`SetDateTime` (source-scan
  clean). The RTC is measured, never written (and cannot be set over BLE anyway).
- **Clock Contract UNTOUCHED** — the device stamp is parsed by explicit regex (never `new Date`); the
  comparison is device-vs-host at the ingest boundary; nothing here rewrites a capture's `tMs`.
- **Reference is the box UTC, because the device tracks ~UTC** — MEASURED on the box 2026-08-24: the
  AS11 read `01:35` while true UTC was `01:16`, i.e. it keeps ~UTC and is ~21 min fast **vs UTC**, NOT
  the box's local zone. So the host reference is `time.time` (box UTC) and `offset = host_UTC − device`
  is the device's deviation from UTC. ⚠️ A first pass compared to the box's LOCAL clock
  (`datetime.now`, EDT −4 h) and mis-reported the offset as **−4 h 21 m** — the box timezone, not the
  device's error; corrected to compare against UTC. The RATE (slope) is invariant to the reference.

## Files (increment 1 — the probe; daemon sidecar is the follow-up)
- **`as11_clock.py`** — pure: `parse_device_epoch_s` (Clock-Contract regex → epoch), `analyze`
  (offset + `slope_ppm` + `ppm_floor` + `minute_is_real` + `verdict`; refuses on < 2 anchors / no
  span), and `ClockSidecar` (the `AS11CLOCK.csv` writer — blanks never fabricated zeros).
- **`probe_as11_clock.py`** — operator tool to run against a session tonight: poll `GetDateTime` beside
  the box clock every `--interval` s, write an anchor per read, print the offset+rate verdict at the
  end. bleak edge pragma'd (mirrors `capture._cpap_ble_connect`); orchestration fully injected + tested.

## Is this a second AS11 sidecar?
Today the AS11 has **zero** sidecars — this is the first. BLE arrival-jitter and RTC-offset are separate
measurements at different cadences (per-sample transport quality vs periodic clock correctness), which is
why the **O2Ring keeps them as two distinct sidecars** (`PmdArrival` + `RingClock`). If the AS11 later
gets a jitter sidecar it would be its own, matching the ring — but that is not built here; tonight is the
clock sidecar only.

## Rollout
1. **Increment 1 (THIS PR):** the analysis + sidecar + operator probe — run it across tonight's session
   to characterise the offset and the fixed-vs-drift question, and make tonight's EDF re-anchorable.
2. **Increment 2 (follow-up):** wire the sidecar into the daemon CPAP capture (an `As11ClockLogWriter`
   in `writers.py`, mirroring `RingClockLogWriter`), so every session records `AS11CLOCK.csv` beside the
   EDF automatically, and CPAPDex/ingest re-anchors the EDF start from the recorded offset.

## Measured (2026-08-24, on the box — the probe run live)
- **Offset = −21.26 min vs UTC** (−1275 s; device 21.26 min fast) — the known "~21 min," now pinned.
  Confirmed on **two independent adapters** (hci1 free, hci0 daemon's) agreeing to **sub-second** — so
  the offset is a device-clock property, not transport. **hci2 (Zephyr) cannot do the AS11 encrypted
  GATT** (`BleakGATTProtocolError`), so it is not usable for CPAP capture.
- ~~**Rate not yet resolved** — 12-second runs give a ~100000 ppm resolution floor~~ **RESOLVED
  2026-09-01 (Heron), from the daemon sidecar itself** — the very channel increment 2 wired. Ran
  `as11_clock.analyze` over the box's full `/srv/tepna/AS11CLOCK.csv`: **n = 8,276 anchors,
  span 160.0 h (2026-08-25 → 09-01), offset −1277.95 s (−21.30 min), slope −4.71 ppm against a
  1.74 ppm floor → `minute_is_real: false`.** The AS11 RTC ticks measurably slow: ≈ −0.41 s/day
  (per-day medians walk −1275.94 → −1278.56 s monotonically across the week, ≈ −5 ppm — two routes,
  one answer). Per-night rates scatter −0.9 to −5.0 ppm on coarser intra-night floors.
  **What this settles:** a device minute is NOT exactly a real minute, but per-night the drift is
  ~0.14 s over 8 h — negligible against the −21.3 min offset, so a per-session measured OFFSET (which
  the sidecar provides) is the right model; a stale offset ages at ~1 s per 2.5 days, so the
  per-session re-measure the daemon already does is load-bearing, not ceremony.

## Done when
- `as11_clock.py` + `probe_as11_clock.py` land with `check.sh` green (ruff, find_unwired, pytest 100%). ✓
- One session characterised on the box → offset confirmed (−21.26 min ✓) and the RATE answered
  (fixed vs ppm) from a long run — **✓ answered 2026-09-01: −4.71 ppm over 160 h / 8,276 anchors
  (floor 1.74 ppm), see Measured.**
- READ-ONLY + Clock-Contract-untouched confirmed by source scan. ✓
