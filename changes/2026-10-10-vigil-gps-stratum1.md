<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host, docs]
brief: VIGIL-GPS-STRATUM1-2026-10-10-BRIEF.md
---
Make the capture box a stratum-1 clock on its own u-blox M10 GPS, the LAN's standard way: a PPS line-discipline
unit (`tepna-pps-ldattach.service`), a chrony drop-in (`refclock PPS prefer`, no `lock GPS`, no SHM, `allow` LAN,
`local stratum 10 orphan`), gpsd on the CP2102 at 38400 for position only, a receiver-tune helper re-applied at
every gpsd start, and an idempotent root installer `deploy/enable-gps-stratum1.sh`. The monitor's Clock & NTP card
now compares this box against every clock it can see (`/api/clock` → `chrony.sources`, every quantity in seconds)
and the sidebar's host-clock pill adds `vs <server>` offsets. `docs/VIGIL-GPS-STRATUM1.md` documents wiring,
read-only detection, bring-up, measured results and maintenance.
