<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---

**Vigil monitor Overview: CPAP + host-clock tiles in the box-health strip.**

The Overview is the page people actually watch, but the CPAP harvest verdict and the host-clock facts
lived only in the Devices view. Two new box-health tiles: **CPAP** (the harvest state — wording comes
from `cpapStatusLabel`, the one map the Devices card uses, so the two surfaces cannot drift; hidden
entirely unless the poller is enabled) and **Clock** (stratum + time source, when the last sync actually
landed, jitter, skew, and the server — "unsourced" with the reason when the host is not disciplined).

`host_clock.py` now parses chrony's `Ref time (UTC)` into `last_sync_utc` (explicit regex + month map,
locale-proof; calendar-validated via `datetime`, so an impossible date becomes absence, never a rolled
instant — the same honesty rule as clock.js `_ckMk`). timesyncd reports no equivalent, so it stays None
on that path. The tile's "synced N ago" comes from an explicit-parse `agoUtc` (Clock Contract at the
display boundary: regex + `Date.UTC`, unparseable renders as nothing). Both tiles' server-derived text
goes through `esc` — the CPAP label carries device names, the stored-XSS path the escaping audit pinned.
