<!--
  VIGIL-GPS-STRATUM1-2026-10-10-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-10-10 · **Created:** 2026-10-10 · **Doc:** `docs/VIGIL-GPS-STRATUM1.md`

# Vigil on its own GPS: stratum 1 wired the LAN's standard way, served, and read by the monitor

## 0 · Owner rulings (2026-10-10, verbatim where quoted)

- "on vigil is new gps, please try to detect pps and gps possibly wire stratum 1" → detection was done read-only first (§2 of the doc) and proved both signals before any root step.
- "wire it permanently standard way like .75 is" → the digipi shape: `refclock PPS … prefer`, **no `lock GPS`, no SHM**, `allow` the LAN, `local stratum 10 orphan`. The first-night bring-up had used `lock GPS` + SHM; the installer retires it.
- "enhance time info in sidebar and comp internal time with network time on sidebar card" → `/api/clock` gains `chrony.sources` (every source *minus this box*, seconds) and `chrony.tracking`; the card renders a comparison table; the sidebar pill adds `vs <server>` bits.
- "create detailed documentation" → `docs/VIGIL-GPS-STRATUM1.md`.
- "ship kestrel pr to merge it" → this unit goes to Kestrel's queue for the PR.

## 1 · Pre-stated before the root step

- The PPS reaching DCD was established by polling the UART's modem bits for 4 s (expected ≈4 rising edges; measured 4). NMEA was expected at 9600 per the sheet; measured garbage at 9600 and clean sentences at 38400 — the sheet was wrong, the installer uses 38400.
- Expectation for chrony: `#* PPS` within 10 min; PPS std-dev under 5 µs within an hour; agreement with the NTP250 within ±500 µs. Reading rule: a PPS std-dev above 10 µs or a disagreement with .123 above 1 ms means a wiring/edge problem, not a config problem.

## 2 · Measured

17:04 EDT: `#* PPS`, stratum 1, PPS std-dev 2.35 µs, vs .123 +365 ns ± 5.9 µs. 21:30 EDT: PPS std-dev **0.151 µs**, system time 1.45 µs fast, skew 0.161 ppm, root dispersion 37 µs; vs .123 −151 µs (within the band; the NTP250 is now the one being measured). All inside the pre-stated bands.

## 3 · What this unit ships

- `capture-host/systemd/tepna-pps-ldattach.service`, `capture-host/systemd/tepna-gps-pps.chrony.conf`, `capture-host/tepna-m10-tune.sh`, `capture-host/deploy/enable-gps-stratum1.sh` (idempotent root installer, deploy style).
- `capture-host/host_clock.py`: `parse_chrony_sources`, `parse_chrony_sourcestats`, `parse_chrony_system_offset`, `read_sources()`; `clockcfg.status()` carries `chrony`; `monitor.html` card table + pill bits. Tests: `tests/test_host_clock_chrony_sources.py` (verbatim vigil fixtures), `tests/test_clockcfg.py` (the `chrony` key, stubbed).
- `docs/VIGIL-GPS-STRATUM1.md`; DOCS-INDEX rows; changeset.

## 4 · Not done, deliberately

- The C-state/governor latency trim (sheet §5 step 8) — a measured before/after is the only honest way to apply it; left for the owner.
- Adding `192.168.0.41` to the fleet's chrony clients — a separate, owner-approved unit per host.
- A gps-watchdog as on digipi — not needed without `lock`: chrony fails over to .123/.75 on PPS loss by itself.
