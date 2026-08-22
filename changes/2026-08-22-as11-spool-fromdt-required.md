<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md
---

**AS11 `StartSpool`: `fromDateTime` is required — the "optional" path built a request the device rejects.**

Validated live against a real AirSense 11: an empty spool address (`spoolAddress.<type>: {}`) is
rejected with `Invalid Params (-32602)`, and so is a request that omits `maxSpoolSize`. The shipped
`start_spool` treated `fromDateTime` as optional, so `pull_spool(from_dt=None)` — the default — always
failed on round 1. `from_dt` is now required across `start_spool` / `pull_spool_round` / `pull_spool`
(a falsy value raises `ValueError` rather than building a request the device will refuse); `maxSpoolSize`
was already sent. With a `from_dt` passed, the full encrypted pull works end-to-end — reconnect →
GetDateTime → Summary spool (639 bytes reassembled off the device).
