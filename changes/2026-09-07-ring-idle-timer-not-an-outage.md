<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The O2Ring powers itself off about two minutes after it is taken off, and the daemon read that as an outage — a reconnect backoff spent against a radio that is off, and a false "capture is missing it" alert five minutes later, for a ring whose night had already been pulled. Measured over 244 harvested sessions: the ring's own idle timer runs 121.9 s (n=23, sd 1.18) from the last worn frame, while our not-worn drop fires at 47.9 s (n=18, sd 2.33) — and the two bands are separated in time, not mixed, every observation of the ring's timer falling on or before 2026-08-26 and every observation of our drop on or after 2026-08-27, which is what makes 121.9 s a hardware figure rather than a measurement of ourselves. A non-advertising ring whose stored session has been pulled is now named `ring powered off — idle timer`, expected until re-wear or charger, logged once instead of every backoff cycle and carrying no alert. Two bounds keep that from becoming a permanent silence: only a pull that actually COMPLETED licenses it, so a doff whose pull failed or ran partial still alerts with the night's data still on the device; and the state expires after 8 hours, after which a ring that is genuinely flat or forgotten goes back to alerting, because a false all-clear is worse than the false alarm it replaces.
