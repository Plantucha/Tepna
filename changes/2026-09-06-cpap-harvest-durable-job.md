<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [capture-host]
brief: none
---
A post-therapy CPAP harvest is now a durable job rather than a fired flag, so a restart mid-harvest re-queues the night instead of reporting it done: the therapy-end trigger persists `therapy_ended → harvest_requested → harvest_attempted → harvest_completed` (or `harvest_deferred`, with the reason) to an append-only fsynced `cpap-harvest-jobs.jsonl`, only a completion carrying a completion stamp can stop a future harvest, and every other state — including an unreadable record or one claiming completion with no stamp — re-queues. The 13:00 window is demoted from primary trigger to reconciliation: an outstanding job now drives the loop immediately, and the window asks the job store before paying for a card read so it cannot double-harvest. Two restart paths learned to wait for a harvest the way they already wait for a recording — `tepna-update.sh`'s interlock reports `harvesting` and defers with its own branch (the catch-all would have failed the unit for what is correct behaviour), and the monitor's restart/stop/reboot endpoint answers 409 with a `force` hatch. The legacy `cpap-therapy-end-fired.json` is migrated once, as a re-queue rather than a completion, and deleted, because it only ever recorded that a trigger fired. Measured cause of the incident behind this: 127 daemon restarts in six days, every one a clean exit, median 18/day, all deploys — one landed 108 s into a harvest and the card was not read for another 5.5 h.
