<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: O2RING-ADAPTIVE-TIMEBASE-FOLLOWUPS-2026-08-09-BRIEF.md
---
Retract the GPS-PPS recommendation — vigil already syncs to a real LAN stratum-1 — and record §1 as DONE.

The follow-ups brief's §3 proposed a ~$45 Navisys GR-701W USB GPS (PPS over DCD) to "give vigil a real
stratum-1". Measured on the box and it is unnecessary: `/etc/chrony/chrony.conf:49` is
`server 192.168.0.123 iburst prefer` with **no `local` directive** (so not chrony orphan mode),
`chronyc -n sources` shows that server at **Stratum 1** (selected, reach 377, +74 us) and
`chronyc -n sourcestats` at **0.007 ppm** freq skew / -19 ns offset / 12 us std dev over 90 min. vigil is a
legitimate stratum-2 client of a genuine LAN stratum-1, so the shipped `timebase_decision` gate is choosing
`host-disciplined` on a well-founded stratum, not a self-asserted one.

The retraction is written up rather than deleted, with what it settles (the orphan-mode hazard is real for
other hosts but not this one; the crystal default being rarely exercised at home is by design, and is why
#1089 proves its invariance synthetically) and its cause: the recommendation was written from an
ambiguously-worded note ("chrony/local-stratum-1", read as chrony's `local` directive when it meant a LAN
stratum-1 server) instead of a thirty-second measurement. Added to the brief's process-gotchas as the
headline entry.

Also records §1 (deploy to vigil) as DONE: the box auto-updates, so the running daemon already carried the
feature; finished by hand with a ff-only pull + `sync-apps.sh` and the gitignored `config.yaml` `ppg_fs`
125.738 -> 125.000. Verified live in the CLOCK sidecar (`...;0.028;host-disciplined`). Docs only.
