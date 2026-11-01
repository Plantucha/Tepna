<!--
  BOX-EVENING-2026-10-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** DONE — 2026-11-01 (Wren, owner at the box: T1 PASS on the criterion, T2 SWAMPED, T3 closed by the owner with `allow_resume` false from the restart-drain measurement; results in §6) · **Residue:** 2026-11-01-a-vanished-radio-reconnects-on-the-bluez-default, 2026-11-01-a-replugged-zephyr-board-keeps-its-old-tty, 2026-11-01-ring-idle-off-mid-pull-sends-a-false-night-ended, 2026-11-01-a-connect-failure-logs-as-a-300s-abandon · **Created:** 2026-10-26

# One supervised box evening — three field tests that no rig-side step can run

**What this is.** A runbook for one evening at the capture box. Three open boxes in two briefs need a
person at the hardware, and no code change can tick them. The owner ruled on 2026-10-26 to schedule
the evening this week. This brief puts the three tests in one order, so one session discharges all
three.

**What this brief does not authorise.** Deploys, daemon restarts and `config.yaml` changes on the box
stay owner-authorised, as `CLAUDE.md` §👥.0 says. The owner performs or approves every restart below.
A bird reads the journal and records the numbers. A bird never acts on the box from this text alone.

| test | home brief and box | what it decides |
|---|---|---|
| T1 · wedge drill | `FINISHED-WORK-IMPROVEMENTS-2026-08-20` §C1 | whether the recovery ladder clears a REAL radio wedge |
| T2 · buzz prescription | `FINISHED-WORK-IMPROVEMENTS-2026-08-20` §C2 | the CLEAN, MARGINAL or SWAMPED verdict from `pat-buzz-stability.mjs` |
| T3 · drop test | `OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23` §6 | the `allow_resume` flag of `resume_strategy`, from measurement |

## 1 · Before the evening

1. Heron reads the daemon journal on the box and confirms that capture runs clean.
2. Heron confirms that no deploy is pending. The `recording_state` interlock defers a deploy during a pull.
3. The owner names the start time on the board, thread 8.

## 2 · T1 · the wedge drill (non-sleep session, about 20 min)

1. Start a capture session with every sensor connected. Do not use a sleep night.
2. The owner unplugs the primary radio adapter during the capture.
3. Heron watches the journal for each rung of the ladder: the reset rung, then the failover to the second radio.
4. Record the time at which each sensor recovers on the second radio.
5. Record the result in the header of `VIGIL-OVERNIGHT-FINDINGS-2026-07-24` and in the field-gated note of the failover commit.

A pass is every sensor back on the second radio with no hand action after the unplug. A sensor that
does not recover is a FAIL with its name and the last rung reached.

## 3 · T2 · the buzz prescription (one connection, about 10 min)

1. Keep ONE ring connection open for the whole test.
2. Fire the motor-60 command about 10 times over 7 to 8 minutes.
3. Make the gaps aperiodic. Each gap is longer than 1.1 s.
4. Write down every fire command in a list as you send it.
5. Run `pat-buzz-stability.mjs` on that list only. Exclude any sweep or pre-test fire by the command list, never by time.
6. Record the verdict in `FINISHED-WORK-IMPROVEMENTS-2026-08-20` §C and in `O2RING-BUZZ-FIDUCIAL-2026-08-19` §5d.

The verdict settles the constancy assumption at `pat-align.js:335`, in either direction. UNRESOLVED is
not a result; it means the prescription did not run as written.

## 4 · T3 · the drop test (the next doff window)

1. Start a watcher on the SYSTEM journal before anything else.
2. Take the ring off, so that its next pull transfers a full night.
3. Start the pull.
4. While the transfer is in progress, the owner restarts the daemon.
5. Let the daemon resume or re-serve the transfer, and keep the file it writes.
6. Compare that file with the ring's own record count and size, through the layer-3 check in `oxy_transfer.verify()`.
7. Record the result in `OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS-2026-08-23` §6.

The default stays re-serve-from-start until this test runs. A wrong resume offset gives a right-sized
file with corrupt records and no symptom, so set `allow_resume` to true only on a match of every record.

## 5 · Done when

- [x] T1 recorded in its two home sites, with a PASS or FAIL and the recovery times.
- [x] T2 recorded with a CLEAN, MARGINAL or SWAMPED verdict and the command list it read.
- [x] T3 recorded, and the `allow_resume` decision states the measurement it came from.
- [x] Each home brief ticks its own box and moves its status line in the same PR.

## 6 · Results, 2026-11-01 (owner at the box, Wren reading the journal)

Before the evening, the owner stopped `tepna-radioclock` (U6 paused). All times are box local time (EST).

### Pre-read · `watchdog.usb_path: 1-2`

The 11:06:05 daemon start logged that `watchdog.usb_path` names port `1-2`, and no device is on that port.
The radios were at `1-4` (spare), `1-5` (wearable primary) and `1-9` (CPAP).

The value only arms the USB rebind rung. The rung derives its target from the watched adapter, and it acts only on a btusb device.
The wearable radios are Zephyr boards on cdc_acm, so the rung cannot recover them with any value.
T1 removes the radio, so a rebind has nothing to act on. The owner and Wren ran T1 with the value unchanged.

### T1 · wedge drill — PASS on the criterion, with four findings

The ring, the H10 and the Sense recorded on the primary radio (`hci1`, port `1-5`) before the pull.
The owner pulled the primary at about 13:34:25.

| sensor | last data | recording again | gap |
|---|---|---|---|
| O2Ring | 13:34:25 | 13:34:38 | 13 s |
| Polar Sense | 13:34:25 | 13:35:02 | 37 s (one re-pair) |
| Polar H10 | 13:34:29 | 13:35:21 | 52 s (one re-pair) |

At 13:35:43 the spare (`hci2`) held 3 LE links and the CPAP radio (`hci0`) held 0. Nobody acted on the box after the pull.

Findings:

1. The watchdog ladder did not run. The journal holds no wedge sign, no power-cycle and no `FAILING OVER` line.
   Each reconnect found the pinned adapter absent, logged `falling back to the BlueZ default`, and connected on the BlueZ default controller.
2. The pass depended on which controller BlueZ marked as default. A restart of the spare's attach unit, 4 min before the pull, made the spare the default.
   Before that restart, the CPAP radio was the default. With it as default, the wearables would take the CPAP radio, outside the reservation in `_failover_reserved` and with no commandeered record.
3. A replugged Zephyr board does not attach again by itself. Its `tepna-btattach@<serial>` unit stays active on the old tty, and the kernel gives the board a new `ttyACM` number.
   The owner restarted the unit with sudo twice. The first restart was for the spare at 13:30, after a first pull of the wrong board. The second was for the primary after T1.
4. A pull is not a wedge. T1 shows that capture survives a radio that vanishes. It does not show that the ladder clears a hung radio that stays on the bus.

### T2 · buzz prescription — SWAMPED on all three legs

The owner stacked the ring, the H10 and the Sense, with the H10 as the rigid leg.
A script sent 10 buzz commands at motor 60 on one ring connection, with aperiodic gaps of 29 s to 61 s.
The daemon logged 10 of 10 fires, from 13:43:19.871 to 13:50:09.871 (span 410 s). No sensor dropped its link.
Wren ran `tools/pat-buzz-stability.mjs` with the daemon fire stamps as `--cmds`. Each leg kept 10 of 10 events.

| leg | offsets (ms) | drift (ms/min) | noise SD (ms) | drift charge, 60 s (ms) | verdict |
|---|---|---|---|---|---|
| fire → H10 ACC | 99 – 240 | −5.6 ± 6.1 | 42.8 | 17.9 | SWAMPED |
| fire → Sense ACC | 163 – 479 | −0.1 ± 17.2 | 120.0 | 34.4 | SWAMPED |
| H10 ↔ Sense | −47 – 378 | −1.1 ± 21.7 | 151.7 | 44.4 | SWAMPED |

The budget is 15 ms over a 60 s window.

No leg resolved its slope, so the tool charged each at |slope| + 2 SE.
The H10 leg came closest: 17.9 ms against 15 ms. Its slope SE alone (6.1 ms/min, 12.2 ms at 2 SE) fits the budget. The span met the tool's required span of about 6.2 min. The point slope of −5.6 ms/min, inside one SE of zero, pushed the charge over the budget.

On the Sense leg and the device-to-device leg, the noise of 120 ms and 152 ms needs a span of 17.5 min and 22.2 min. The 6.8 min sequence cannot bound drift there.
For `pat-align.js:335`, the verdict does not support the constancy assumption at the 15 ms budget. It also shows no drift: every slope sits inside one SE of zero.

### T3 · drop test — a restart drains the transfer; `allow_resume` stays unmeasured

**Attempt 1 (14:02).** The owner armed a trigger on the `.part` file and took the ring off. The auto-pull served one daytime session of 7648 B in about 1.7 s. The trigger watched the date folders, and the pull writes in `stored/`, so no restart occurred.

**Attempt 2 (14:09).** The owner moved the box copy of the 2026-10-31 night session to a hold folder, and armed a trigger on `stored/*.part`. Wren started a pull of that one session. The ring served 87130 B in 14 s (14:09:39 to 14:09:53). The trigger did not fire. The file matched the held original byte for byte.

Finding: `pull_session.py` keeps the whole transfer in memory. It writes the `.part` only after the last chunk, and renames it at once. A `.part` on disk exists only after a short pull, such as a timeout.

**Attempt 3 (14:12), the restart.** The owner moved the session aside again and armed a trigger on the first progress line in the journal.

| time | event |
|---|---|
| 14:12:29.754 | full serve of 87130 B starts |
| 14:12:33.153 | progress 20480 B (23 %) |
| 14:12:33.513 | systemd sends the stop, the daemon logs `shutdown: stopping 25 task(s)` |
| 14:12:44.327 | the pull saves 87130 B |
| 14:12:46.998 | the daemon logs `tepna-capture stopped`, 13.5 s after the stop |
| 14:12:47.150 | systemd starts the new daemon |

The daemon did not drop the transfer. Its shutdown let the pull finish inside the 90 s stop timeout. The saved file matched the held original byte for byte. `oxy_transfer.verify()` passed all three layers: 29024 records at 87130 B, equal to the trailer `total_seconds`.

The new daemon restored the quiet state of 1 device from `alert-quiet.json` and sent no `sensor offline` alarm. This is the first restart on the #4224 build, and it confirms that fix.

Result for `allow_resume`: NOT_RUN. A restart cannot feed a resume, because no partial bytes reach the disk. Only a transfer that stalls past the 20 s chunk timeout writes a short `.part`. A link that disconnects can raise before that write; nobody tested that case. The flag stays false, and the default stays re-serve-from-start.

**Attempt 4 (14:17), a shielded link.** The owner held the ring off the finger beside a metal tin, and the trigger signalled at the first progress line (14:18:06). The owner did not report when the tin closed. The transfer ran without a stall, about 2.8 s for each 20480 B, and saved 87130 B at 14:18:15. The file matched the held original byte for byte, and no `.part` appeared. No stall occurred inside the transfer window.

The first pull request of this attempt (14:17:07) did not connect within 30 s, and the daemon logged it as `exceeded 300s and was abandoned`.

Each re-pull also rewrote the session's `.meta.json` sidecar. Wren deleted the held copies after the byte compare.

Side finding: in attempts 2 and 3 the ring logged `powered off — idle timer` during the pull (14:09:23, 14:12:25), and the box sent a `night ended` alert each time. The same line appeared at 11:04:52 on the earlier build.

**Closure (2026-11-01).** The owner closed T3 after attempt 4, with no further attempts. The measured part is the restart drain. The `allow_resume` decision stays false, from this measurement: a restart writes no partial bytes, so no resume input exists. A stall past the 20 s chunk timeout that does not disconnect is the only route to a short `.part`, and nobody has measured it.
