<!--
  NIGHTCHECK-2026-11-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** IN-PROGRESS — 2026-11-01 · **Created:** 2026-11-01

# An automatic morning check reads each capture night against nine criteria

**What this is.** The owner asked for automatic checks of the 2026-11-01 night, after the box evening
of `BOX-EVENING-2026-10-26-BRIEF.md`. Kestrel and Wren proposed five checks on the board (thread 7,
#2837). The owner added four more on 2026-11-01. This brief states the nine criteria and records each
result.

## 1 · Scope

A read-only script on the capture box reads one night. The window runs from 18:00 on the night date
to 07:30 on the next day, in box local time. The script reads the capture journal, the system
journal, the watchdog log and the night folders. It writes one report and one `tepna.verdict/1`
object per check, under the Wren home folder.

The script writes nothing under the box system paths. It needs no `sudo`, and it restarts no unit.
A one-shot systemd user timer starts it at 07:30. Wren reads the report at resume and records it in
§4.

The script stays box-local for this unit. It reads box-local logs that no committed fixture holds.
A move into `capture-host/` needs synthetic fixtures and the capture-host gate (§5, open item 1).

## 2 · The nine criteria

The criteria come before the data. No threshold below comes from the night it judges.

| # | gate | reads | PASS when |
|---|---|---|---|
| 1 | `nightcheck-radioclock-census` | `*_RADIOCLOCK.csv` sidecars | each Polar device has a sidecar with rows |
| 2 | `nightcheck-radio-anchor-spread` | sidecar frame-change rows | robust spread below 2 ms for each Polar device |
| 3 | `nightcheck-quiet-restart` | capture journal | no `sensor offline` alert within 10 min after a daemon start |
| 4 | `nightcheck-idle-off-mid-pull` | capture journal | no `night ended` alert within 5 min after an idle-off inside a pull |
| 5 | `nightcheck-rtc-push-time` | capture journal | each `RTC pushed to host` stamp within 2 s of its log time |
| 6 | `nightcheck-coverage-census` | night folders | each worn device has stream files with a last write in the window |
| 7 | `nightcheck-watchdog-false-restart` | watchdog log, capture journal | no watchdog restart within 35 min after an offline-recording op or a ring pull |
| 8 | `nightcheck-update-restart` | system journal | no auto-update restart from 21:00 to 07:00 without a charger links line |
| 9 | `nightcheck-h10-connect-rate` | capture journal | fewer than 20 H10 connect timeouts in each clock hour |

Notes on the criteria:

- Check 2 takes `d = last_sensor_ns/1e6 − anchor_us/1e3` on each frame-change row. It takes each
  residual against a running median of width 21. The spread is 1.4826 × MAD of the residuals.
- The spread bands come from `RADIO-CLOCK-SIDECAR-2026-09-07`: below 2 ms reads as a radio clock,
  2 ms to 50 ms as a jitter aid, and above 50 ms as no use.
- The ring writes no sensor stamp, so check 2 reads the Polar devices only.
- Checks 3, 4 and 7 to 9 are owner additions or witnesses for open residue rows.

| check | why |
|---|---|
| 3 | a second witness for #4224 |
| 4 | evidence for row `2026-11-01-ring-idle-off-mid-pull-sends-a-false-night-ended` |
| 5 | the 2026-11-01 05:43 push carried the pre-DST offset (§4.1) |
| 7 | the 2026-11-01 15:00 watchdog restart (§4.1) |
| 8 | owner addition: auto-update restarts in worn hours |
| 9 | owner addition: H10 connect failures |

## 3 · Acceptance

- [x] The owner approved the timer and the nine checks (2026-11-01).
- [x] A dry run on the 2026-10-31 night emits nine verdict objects and a report (§4.1).
- [x] The report carries no serial, no address and no device file name.
- [ ] The timer runs on 2026-11-02 at 07:30 and reads the 2026-11-01 night (§4.2).
- [ ] Wren posts the result to Kestrel on the board.

## 4 · Results

### 4.1 · Dry run on the 2026-10-31 night (run 2026-11-01, 3.9 s, 65 MB peak)

That night ran the build before #4224. Check 3 fails by construction on that build, so the dry run
tests the script, not the fix.

| # | status | measurement |
|---|---|---|
| 1 | PASS | Sense 39288 rows, 17:21 → 05:42 · H10 130546 rows, 22:40 → 05:44 |
| 2 | FAIL | Sense 158.227 ms over 39168 frame changes (no use) · H10 26.114 ms over 130544 (jitter aid) |
| 3 | FAIL | 8 of 8 daemon starts sent 3 `sensor offline` alerts each; 26 in the window |
| 4 | PASS | 7 pulls, 2 idle-off lines, 0 inside a pull |
| 5 | FAIL | 1 of 3 pushes off: 05:43:05 pushed 06:43:05 (Δ +3600 s) |
| 6 | PASS | ring, H10 and Sense streams each have a last write from 05:43 to 05:44 |
| 7 | NOT_APPLICABLE | no watchdog restart in the window |
| 8 | FAIL | 2 of 8 auto-update restarts at 05:50 and 06:01, with no links line |
| 9 | PASS | peak 18 H10 connect timeouts in one hour (20:00) |

Findings from the dry run and the same day:

1. **RTC push after DST.** The daemon process that started before the 02:00 DST change kept the EDT
   offset. At 05:43:05 EST it set the ring 1 h ahead. Each push after the 07:01 restart matched its
   log time.
2. **Watchdog restart for an explained silence.** At 15:00 the watchdog restarted the daemon. The
   ring and the Sense had no sample for about 1750 s. The Sense was in an offline-recording op, and
   the ring was off the finger. The connected-but-silent rule reads neither state.
3. **U6, first night.** Check 2 gives one night of the U6 radio-anchor read for
   `DEVICE-TIME-HANDLING-2026-10-29`. Neither Polar device reads in the radio band. One night does
   not decide U6.

Wren proposes residue rows for findings 1 and 2. Kestrel sequences them. The watchdog script is a box
file, so a change to it is the owner's call.

### 4.2 · The 2026-11-01 night

Owed: the timer runs at 07:30 on 2026-11-02.

## 5 · Open items

1. Move the script into `capture-host/` with synthetic fixtures, if the owner wants the check kept.
2. Log the two proposed residue rows from §4.1 when Kestrel sequences them.
