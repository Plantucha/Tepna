<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23-BRIEF.md
---
🔴 **The updater could restart the daemon in the middle of a ring `.dat` transfer.**
`tepna-update.sh`'s `recording_state` deferred on `recording` and on a CPAP harvest
(`cpap.state == "running"`) — and returned **`idle`** while `oxy_lifecycle` read `pulling` or
`paused_for_pull`. A stored-session pull was simply not work in flight as far as the interlock was
concerned.

⚠️ **The defect predates `tepna-update-pending.timer`; enabling that timer is what made it routine.**
The doff does two things in the same moment: it **ends the recording** (so the box turns idle) and it
**triggers** the not-worn auto-pull. With the hourly timer alone a restart landed in that window
roughly one tick in thirty; with the 2-minute timer enabled (2026-09-12) it fires ~2 min after idle,
squarely inside a pull that starts ~60–80 s after the doff settle.

**Bounded, not fatal — which is why this is a deferral and not an alarm.**
`oxy_transfer.resume_strategy` runs with `allow_resume=False`, so an interrupted transfer discards its
partial bytes and re-serves from byte zero. Nothing is spliced; a harvest is wasted and retried. That
is the safe half of the asymmetric bet the G1 brief describes, and it is why the consequence was a cost
rather than a corruption.

`pulling` is its **own** state with its own message, not a reuse of `harvesting`: the one-line fix would
have printed "a CPAP harvest is running" and sent whoever read it to the wrong subsystem.

⚠️ **Absence reads as `idle` here, the opposite of the `cpap.state` rule directly above it, and
deliberately.** `oxy_lifecycle` is a RING field — the Polars and the Coospo never publish it — so
requiring presence would make every non-ring device read `unknown` and refuse restarts forever on a box
with no O2Ring. Same judgement as `cpap`'s "no block at all → idle" arm.

Found while triaging the brief's one remaining item, whose subject is precisely "pull-before-restart
order". **It does not retire that item:** this stops the accident, it does not measure whether mid-file
resume is safe, and `allow_resume` stays `False` until the physical drop test runs.
