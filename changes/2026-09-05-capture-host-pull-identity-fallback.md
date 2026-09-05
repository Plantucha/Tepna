<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---
capture-host: a stored-session pull whose 0xE1 identity read timed out keyed the inventory ledger on the auth serial (`"0000"`), so `oxy_restart.plan` could not see the session was already COMMITTED and pulled it again, overwriting a good sidecar with `device_serial: null` (vigil, 2 of 23 sessions); `pull_session.pull()` now takes the caller's `device_id` as the fallback key (address after it, the auth serial never) and `pull_oxyii_session` passes the ring's configured id.
