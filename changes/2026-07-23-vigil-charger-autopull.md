<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
On-charger auto-pull (out-of-suite capture-host/): pull a device's ONBOARD recordings a settle window
(default 15 s) after it is placed ON THE CHARGER — the fast, event-driven sibling of the hourly
autopull_poller (VIGIL-DEEP-ANALYSIS §2C: the hourly cadence could delay a pull up to an hour). A device
goes on the charger the moment a night ends, so "on charger" is the natural "night over → grab the
onboard backup" trigger. Applies to the O2Ring (OxyII .dat via pull_oxyii_session) AND Polar Verity/H10
(new pull_polar_offline_all over PS-FTP), not just the ring. Opt-in under `pull.auto`; the charger trigger
is `pull.on_charger` (default on) with `pull.charger_settle_sec` (default 15). Safe: a charging device is
not capturing, so pausing it costs nothing, and each pull is bounded + connect-locked; once per charge
session; a failed pull falls back to the hourly poller rather than retry-spamming. Pure trigger helper
`charger_pull_due` + 4 tests; 925 passing.
