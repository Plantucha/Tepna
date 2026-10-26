<!--
  BOX-EVENING-2026-10-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** PROPOSED — 2026-10-26 · **Created:** 2026-10-26

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

- [ ] T1 recorded in its two home sites, with a PASS or FAIL and the recovery times.
- [ ] T2 recorded with a CLEAN, MARGINAL or SWAMPED verdict and the command list it read.
- [ ] T3 recorded, and the `allow_resume` decision states the measurement it came from.
- [ ] Each home brief ticks its own box and moves its status line in the same PR.
