<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED (deferred 2026-10-13 — owner: "Write up Options 2 and 3 for after Saturday") · **Created:** 2026-10-13 · **Follows:** `O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md`

# The ring survives a daemon freeze: drain the backlog, or poll from its own process

**One line.** On night 2026-10-12 the capture daemon froze for up to 16 s at a time. The Polar devices
delivered their samples late and complete. The O2Ring lost 87 s of signal in six gaps, and the night
failed SOLID. This brief states two remedies beside #3554 and the measurement that decides each one.

## 1 · What is already measured

The cause of the freezes is the loss poller (`capture.py:9435`, `poll_sec` 1800). It reads the journal
and judges old nights inside the event loop. #3554 moves that work into the QC child. #3554 is the
first remedy, and this brief does not repeat it.

| fact | value | source |
|---|---|---|
| ring reply cap | 250 samples, about 2 s at 125.9 Hz | `oxyii.py:933` |
| overflow behaviour | the ring discards the excess, with no error and no gap marker | `O2RING-OPCODE-SURFACE` §3 |
| poll period | 1.0 s | `capture.py:468` |
| freezes, old process | 166, longest 16070 ms | journal, night 2026-10-12 |
| freezes, new process | 11 in its first loss poll, longest 4370 ms | `/api/state` `loop` block, 2026-10-13 09:27Z |
| ring gaps that night | 6 unattributed, 87 s | `SOLID-VERDICT.json` |

The night itself shows that the ring kept producing signal during a freeze. At the 00:48 gap the ring's
`duration_s` counter in `OXYFRAME.txt` advanced from 8466 to 8480. The first reply after the freeze
carried 250 samples, and the rest did not arrive.

A count of PPG samples confirms the loss. The count uses a 180 s window around each gap and the ring's
own rate of 125.9 Hz:

| window | deficit (s) |
|---|---|
| six gap windows | 17.0 – 22.3 |
| control window at 02:00, no gap | 2.3 |

## 2 · Option 2 — drain until the ring is empty

**The idea.** After a reply at the 250 cap, the poller asks again at once. It repeats until a reply
comes back under the cap. This recovers a long freeze only if the ring holds more than one reply.

**The nights already answer most of it.** On night 2026-10-12, 27 replies reached the cap. In all 27
cases the next reply, one poll later, carried fewer than 200 samples. A ring with a deeper backlog
would answer 250 again. Nights 2026-10-10 and 2026-10-11 had no reply at the cap.

| night | replies at the cap | next reply under 200 |
|---|---|---|
| 2026-10-10 | 0 | — |
| 2026-10-11 | 0 | — |
| 2026-10-12 | 27 | 27 |

These counts come from the `0x04` frame's `ppg_n` column. The poller asked one second later, not at
once. So one controlled probe is still owed:

1. Run `capture-host/probe_oxyii_0x03.py` on a worn ring under the deadman helper. The owner authorises this box work.
2. Pause the poll for 5 s, so the ring fills past the cap.
3. Send a second request within 100 ms of the first reply at the cap.
4. Record the declared count of both replies over at least 20 such events.

**Criterion, stated before the probe.** A deeper backlog exists when the second reply carries 50 or
more samples in at least 3 of 20 events. Then the drain loop goes into `run_oxyii`. Otherwise Option 2
closes, and the brief records the buffer depth as 250 samples.

**A cheap variant that needs no probe.** The worst-case freeze the ring survives is the buffer depth
minus the time since the last poll. At a 1.0 s period that margin is 1.0 s. At a 0.5 s period it is
1.5 s. The `0x05` path already polls twice per cycle (`capture.py:6545`). A half-second `0x04` period
costs radio time and battery, so it needs its own A/B night before it ships.

## 3 · Option 3 — the ring polls from its own process

**The idea.** A child process owns the ring's BLE session: connect, authenticate, poll and write the
files. A freeze in the parent loop then cannot delay a ring poll. This follows the pattern #3554 sets
for the QC work.

**Build it only if freezes survive #3554.** After the #3554 deploy, Heron reads the `/api/state` `loop`
block over three worn nights. Option 3 proceeds when any stall of 1.0 s or longer falls inside a worn
interval. Otherwise Option 3 closes, because #3554 removed the cause.

**What moves into the child.**

- The connect, the auth and the poll loop of `run_oxyii`.
- The writers for `SPO2.csv`, `PPG.txt`, `PPG2W.txt`, `PLETHA.txt`, `OXYFRAME.txt` and their RUNS sidecars.
- The stall guard and the worn gate.

**What stays in the parent, behind a message pipe.**

- The status that `_set` publishes to the web monitor.
- The live values that `BUS.push` sends to the live view.
- The `_OXYII_PAUSE` and `_RECOVER` signals. The offline pull needs the ring's single BLE link, so the parent must stop the child first.
- The restart of a child that exits.

**A thread is the cheaper alternative.** A dedicated thread with its own event loop also escapes an
event-loop freeze. It does not escape CPU work that holds the interpreter lock. The process is the
recommendation, because the measured freezes are CPU work in Python.

## 4 · Every other freezer: name it, then move it

The owner asked on 2026-10-13 for a check of every other job that can freeze the daemon. The owner
also asked to move each one into its own process.

**What the check found.** The loss poller already runs its heavy work through `asyncio.to_thread`, and
the loop still froze. A thread does not escape CPU work in Python, because that work holds the
interpreter lock. So `to_thread` is not a protection for a job that parses or composes in Python. Only
a child process is.

**What the logs can name.** The journal rate-limits the stall warning, and the `loop` block holds only
a count. So the logs name a freezer only by its timing.

| stall time | length (ms) | job that ran just before |
|---|---|---|
| every ~31 min, 20:02 → 05:27 | 1014 – 16070 | loss poller (`poll_sec` 1800) |
| 02:13:33 | 2574 | archive push at 02:10:51 (2026-10-08 night) |
| 4 stalls after the 08:57Z restart | unlogged | unknown |

**The static audit.** These periodic jobs run CPU work in Python in the daemon process after #3554
lands. Each one is a candidate, not a finding:

| job | where it runs | caller |
|---|---|---|
| `nightarchive.archive_night`, `mirror_subtree` | thread | `archive_poller` |
| `sealbox.night_signature`, `write_card` | thread | `seal_poller` |
| `nightqc.write_verdicts` | thread | `qc_poller` |
| `nightqc.attach_wear`, `nightqc.qc_digest` | the event loop itself | `qc_poller` |
| `solid_night.code_moved`, `pending_verdict` | thread | `loss_poller` |
| `nightqc.newest_data_mtime`, `data_quiet_s` | thread | `loss_poller` |
| `diskguard.active_nights`, `list_nights`, `prune_old_nights` | thread | five pollers |
| `writers.live_loss_check` | thread | `status_loop` |
| `_rebuild_link_baselines`, `_current_night` | thread | `qc_poller` |
| `cpap_harvest.harvest` | thread | `_cpap_loop` |

**Step 1 — the stall sampler.** A watchdog thread reads the loop lag. When the lag passes 500 ms, the
watchdog takes the main thread's stack and every worker thread's stack with `sys._current_frames()`.
It appends one row to `STALLS.jsonl` beside the night: the time, the lag and the top frames. Then every
freeze names its job, and nobody guesses. This step ships first.

**Step 2 — the moves.** After three nights of samples, each job that appears in a stall of 500 ms or
more moves into a child. The child is the QC child from #3554 (`_qc_offload`, `qc_child.py`), or a
second child where `qc_child` says a second spawn per poll is not available. One job moves per PR.
A job that never appears in a stall stays where it is, and the brief records it.

**Step 3 — the ring.** Option 3 above is the last move. The ring needs it only if stalls of 1.0 s or
more survive steps 1 and 2.

## 5 · Criteria, stated before any run

| decision | rule |
|---|---|
| Option 2 builds the drain loop | a second reply of 50 or more samples in at least 3 of 20 probe events |
| Option 2 closes | fewer than 3 of 20 |
| Option 3 builds | any stall of 1.0 s or longer inside a worn interval, over 3 nights after the #3554 deploy |
| Option 3 closes | no such stall over those 3 nights |
| a job moves to a child | the sampler names it in a stall of 500 ms or more, over 3 nights |
| a shipped remedy works | an injected 5 s parent freeze loses no ring sample in the test, and the next worn night has no ring gap that opens within 30 s of a stall |

Each decision emits one `tepna.verdict/1` object. A night with no worn ring is `NOT_RUN` for the
Option 3 count.

## 6 · Acceptance

1. The stall sampler ships, and three nights of `STALLS.jsonl` counts are in this brief.
2. The probe verdict for Option 2 is in this brief, with the 20 events in a table.
3. Heron's three-night stall count for Option 3 is in this brief.
4. Each option that builds lands with a test. The test freezes the parent loop for 5 s and finds no lost sample from a fake ring.
5. `capture-host/check.sh` exits 0, with 100 % branch coverage and the diff-scoped mutation gate.
6. The owner authorises the deploy in Heron's pane.

## 7 · Related defect, logged apart

After 00:17 on night 2026-10-12, the PPG file's `sensor timestamp [ns]` column steps only 8 ms across
each gap. That column is the host-made grid `O2PpgGrid`, not a ring clock. Before 00:17 the grid
inserted each gap at its true length. After 00:17 it packed the surviving samples back-to-back across
real loss, which the Clock Contract forbids. Nobody has measured the mechanism.

This defect goes to
`briefs/RESIDUE.md` as its own row when the RESIDUE slot frees. It is outside this brief.

## 8 · Out of scope

- A backfill from the ring's stored recording. That record carries vitals, not the waveform.
- The Polar paths. They delivered late and complete on the same night.
- The SOLID thresholds `UNATTRIBUTED_MAX_N` and `UNATTRIBUTED_MAX_S`. A freeze-caused gap stays a fault.
- The attribution of a gap to a stall. Heron's row `2026-10-13-the-stall-that-tore-the-ring-is-invisible-to-the-attribution` holds that.
