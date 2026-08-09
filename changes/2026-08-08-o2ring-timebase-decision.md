<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md
---
O2Ring timebase — Stage 3a: the per-capture timebase DECISION, stamped in the CLOCK sidecar.

`host_clock.timebase_decision(state)` picks which RATE reference a capture should be analysed on:
**device-crystal** by default (the O2Ring's 125.000 Hz ±40 ppm crystal — trustworthy anywhere, the safe
floor), and **host-disciplined** only when the host EARNS it. The bar is stricter than absolute-time
trust: `classify()` grants `absolute_ok` up to stratum 4, but rate-trust requires a genuine reference
clock — **stratum ≤ 1** (PPS/GPS-backed) AND, where chrony reports it, a frequency **skew ≤ 1 ppm**
(`TIMEBASE_MAX_STRATUM` / `TIMEBASE_MAX_SKEW_PPM`). A stratum-2+ NTP client is `absolute_ok` yet its rate
may be worse than the crystal, so it stays on the crystal; a stratum-1 source with a loose/unsettled skew
also falls back. This is the owner's architecture: "default 125, but if somebody has stratum-1 then that
will be chosen path."

The decision rides `read_state()` and is recorded per capture as a new **`timebase`** column on the CLOCK
sidecar (appended last, back-compat) — so a reader sees which clock governed each night and why, the "info
about what clock precision is used for capture" the owner asked for. It does NOT stop syncing or touch
absolute-time handling; it only picks the rate, and PpgDex consuming the stamp is Stage 3b.

capture-host suite green at the 100 % statement+branch floor; ruff clean.
