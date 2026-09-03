<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: O2RING-PROTOCOL-2026-07-17-BRIEF.md
---
`parse_oxy_trailer` never read the recording start time. `T+8` is a u32 present in every stored `.dat`,
so the session's own start stamp was dropped and callers inferred one from the filename. Returned as
`start_t_ms`, documented as a FLOATING wall-clock epoch (local civil time encoded as if UTC — the Clock
Contract's canonical form), measured on six real files as +0.00 h against the local stamp. Also surfaces
`interval_s`, `sample_count`, `duration_s`, and `asleep_seconds` / `pct_below_90` / `steps`, which the
public reverse-engineering reference marks "reserved (zero)". Every pre-existing key is unchanged.
