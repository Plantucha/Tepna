<!--
  how-to-collect/cpap-edf.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# How to collect — ResMed CPAP (AirSense 11) EDF

**Device:** ResMed **AirSense 11** (AirSense 10 similar).
**Signal:** per-night therapy **EDF** — ~25 Hz BRP flow waveform, pressure, leak + **device-scored
EVE/CSL events** → **CPAPDex**.
**Adapter / path:** **binary EDF drag-drop** into **`CPAPDex.html`** (or the OverDex CPAP ingest). EDF
is binary, so it does **not** traverse the live-host text/BLE path — there is no `cpap` BLE stream
(`CPAPDEX-PHASE9-FOLLOWUPS §2`). CPAP joins the box as **files**, not a captured stream.
**Adapter id:** `resmed-edf` (`adapters/resmed-edf.js`). This doc is the device-named collect guide for
that adapter — the how-to-collect set uses device-descriptive names (`verity-ppg`, `wahoo-tickr-rr`,
`welltory-hrv`) rather than strict `<adapter-id>.md`, so it keeps this filename (referenced from
`adapters/resmed-edf.js`, the Data Unifier / OverDex source, and `how-to-collect/health-box.md`).

## ⚠️ Use the SD card — NOT ResMed Wi-Fi / myAir
The AirSense's cellular/Wi-Fi modem uploads **compliance summaries only** to myAir / AirView — usage
hours, AHI, leak summary, a daily score — **not** the flow waveform or the full EDF. The data CPAPDex
needs lives **only on the SD card**.

## Capture
**A — SD card (canonical):** power off, pull the microSD, copy the `DATALOG/` folder's per-night
`*.edf` files (+ `STR.edf` summary) with a card reader. This is exactly what OSCAR reads.

**B — Wi-Fi done right (auto, for the health box):** put an **ez Share** (or FlashAir-style) **Wi-Fi
microSD adapter** in the CPAP. The `tepna` box then auto-pulls `DATALOG/` over Wi-Fi into
`captures/cpap/DATALOG/<YYYYMMDD>/` — full-fidelity data, no daily card swap. This is the only
"wireless" route that yields the real waveform (the machine's own Wi-Fi does not).

**Running, not planned** — `capture-host/cpap_harvest.py` + `capture.py`'s `cpap_poller`, executing
`briefs/CPAP-AUTOHARVEST-2026-07-26-BRIEF.md`. To enable it:

```yaml
cpap:
  enabled: true
  at_hour: 13                 # ONE daily window. Not a poll loop, and not the morning — see below.
  dest_subdir: captures/cpap
  base_url: http://192.168.4.1        # the card's AP; its LAN address if you run it in station mode
  wifi_iface: wlp1s0                  # discovered when unset; must NOT be the box's uplink
```

Four things about that config are load-bearing, each measured rather than assumed:

- **13:00, not 09:00.** On the real card, **6 of the 14 most recent nights were still being written
  after 09:00** (last write 08:35→12:02, median 08:56) — and the late files are the big ones. A
  morning pull routinely takes the two small files, misses the flow waveform, and reports success.
- **One window, never a poll loop.** The card is 2.4 GHz-only and this box holds four BLE links all
  night; a transfer during capture cost **5–7 dB and 17 reconnects**. The poller refuses while any
  sensor is streaming, and defers rather than consuming the day's slot.
- **The card must not become the default route.** It routes nowhere, so a headless box that takes it
  is unreachable until someone walks over. The harvest reads the default-route device *before*
  associating and tears the association down if it moves.
- **If the card is already reachable, nothing is associated at all.** Station mode — or any deployment
  where the card sits on the LAN — skips the whole privileged branch; the download is a plain
  unauthenticated HTTP GET and never needed a privilege. On a box with no Ethernet this is the *only*
  safe option, and `capture-host/deploy/enable-cpap-wifi.sh` refuses to configure the alternative.

Steady state is one night, ~2.5–4.7 MB, under 20 s. The first backfill mirrors the whole card — ours
was 197 nights / ~530 MB, because ResMed's documented "30 sessions of detailed data" limit had not
rotated it. A run that fetches nothing **and** skips nothing publishes `barren` and alerts; it does
not read as success.

⚠️ **Before you write your own puller, read
`briefs/EZSHARE-CARD-INTEGRATION-2026-07-28-BRIEF.md`.** The card's directory listing reports
`ceil(bytes/1024)`, so the natural symmetric completeness check rejects roughly half of all complete
files, forever. That cost us 487 rejected byte-perfect downloads before it was found.

## File layout & naming
Copy the native ResMed `DATALOG/YYYYMMDD/*.edf` set as-is (CPAPDex reads the EDF structure). If you
flatten into a night folder, keep the date in the name so the anchor is unambiguous:
`ResMed_AirSense11_<SerialOrId>_YYYYMMDD_*.edf`.

## Clock Contract
EDF carries its own start date/time in the header — parsed by **explicit regex** into floating `tMs`,
never `new Date(str)`. ResMed is MDY-free (header is explicit `YYYY`-first datetime); read back via
`getUTC*` so the night is viewer-timezone-independent.

## Where it goes
Drop the night's `*.edf` into **`CPAPDex.html`** → it builds a `ganglior.node-export` (flow/pressure
metrics + device-scored EVE/CSL events). Fused with OxyDex/ECGDex, the CPAP events corroborate
desaturation + autonomic-surge findings across nodes.
