<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS (owner-ordered 2026-09-22 — *"do deep audit of logic for all devices how data is captured, this data loss is unacceptable"*; §1–§4 are the audit, measured on the box. **Owner rulings 2026-09-22 (relayed by Kestrel, option labels verbatim): R1 = "Per-unit can-charge capability"; R2–R4 = "Yes, all three".** R1 + R2 BUILT the same day (`should_drop_not_worn(can_charge=)` reads devcaps `can_charge`, recorded where a charge is MEASURED — `battery-rose`, `pmd-in-charger`; absent ⇒ never dropped, and the flat-at-full inference never fires); R4 and R3 next, in that order) · **Created:** 2026-09-22

# CAPTURE-LOSS-PRECEDENCE-AUDIT — where the box loses a night it was wearing, measured

> **Owner, 2026-09-22 04:07:** *"Why is h10 not recording."* Then: *"Do deep audit of logic for all
> devices how data is captured this data loss is unacceptable."*
>
> **Kestrel's frame, adopted:** the two H10 fixes of the same night (#2781: a contact bit outvoted a
> heartbeat; #2831: an inferred dock outvoted a heartbeat) are one pattern — the worn verdict is a
> PRECEDENCE among votes, and each fix moved one vote. So this audit is the precedence table itself,
> per device, with every vote's source, and the box journal's drop reasons counted against it over
> the whole capture history — so the next row is found by the table, not by the next lost night.

## 0 · The metric, pre-stated

**Data loss = minutes of worn-but-not-recorded, per device, per night.** Operationally, on this box:

- *not recorded* = a gap in the device's PRIMARY stream longer than the stream's own delivery cadence
  (`nights_index._cadence_gap`: max(2 s, 5 × the head's p95 step) — the Nights page's fragment cut);
- *worn* = the device's own beat/contact evidence in the same night (H10 HR/RR rows > 0; Verity PPI /
  pulse; ring SpO₂ in range). Where a gap has no such evidence on either side it is counted but not
  charged as worn-loss;
- *cause* = the last journal line for that device in the 15 s before the gap opened, binned:
  `daemon:*` (the daemon chose to end the link) · `link:*` (the radio failed) · `device:*` (the device
  ended it) · `unattributed`.

Instrument: `audit_attrib.py` (this session's scratch; to be committed under `capture-host/tools/` as
`capture_loss_audit.py` in §5 R4), run over every night on the box since 2026-08-20 (33 nights).

## 1 · The count

Gap minutes by cause, all nights 2026-08-20 → 2026-09-21, primary stream per device:

| device (primary) | daemon: not-worn drop | link: timeout / not found | unattributed | total |
|---|---|---|---|---|
| **Polar H10** (ECG) | **557 min** | 0 | 226 | 783 |
| **Polar Verity** (PPG) | **141 min** | 0 | 204 | 345 |
| **O2Ring** (SpO₂) | 0 | 1 | 13 | 14 |

**The daemon's own not-worn drop is the largest single cause of loss on both Polars — 698 of 1 142
minutes, 61 %.** Link errors, the thing the reconnect machinery was built for, are a rounding error
in the primary streams. The `unattributed` column is gaps with no journal line in the prior 15 s —
mostly the device's own silence (a strap taken off, a link that died without a log line) and the
Verity's known SDK-mode stalls; it is the ceiling on what a better journal could still explain.

Nights under 90 % primary coverage (from the Nights index, fragments · coverage · span):

| night | device | fragments | coverage | span |
|---|---|---|---|---|
| 09-20 | H10 | 154 | 41 % | 6.1 h |
| 09-21 | H10 | 171 | 42 % | 7.0 h |
| 09-03 | H10 | 25 | 76 % | 7.7 h |
| 09-04 | H10 | 80 | 79 % | 3.4 h |
| 09-05 | H10 | 79 | 88 % | 6.7 h |
| 08-21 | Verity | 23 | 82 % | 4.0 h |
| 09-12 | Verity | 79 | 81 % | 11.9 h |
| 08-23 · 08-27 | Verity | 15 · 17 | 2 % | 0.5 h (device off — not worn-loss) |

## 2 · The precedence table — how each device is judged "worn", by source

`telemetry.worn_verdict` combines votes; `capture._publish_worn` feeds `_WORN_SINCE`; after 180 s of
continuous not-worn (`power.drop_not_worn_sec`) the Polar runner DROPS the link and re-checks every
90 s. The drop never fires on `worn = None`. Every vote, in the order it decides:

| rank | vote | source | H10 | Verity | O2Ring | cost when wrong |
|---|---|---|---|---|---|---|
| 0 | `charging` — battery ROSE | **measured** | n/a (coin cell) | ✓ | ✓ (`batt_state`) | none seen |
| 0 | `charging` — PMD `IN_CHARGER` | **measured** | n/a | ✓ | — | none seen |
| 0 | `charging` — flat at 100 % for 45 min | **inferred** (written for the Verity's dock) | ✓ fires! | ✓ | — | **09-21/22: 140 drops, 3.6 h** (#2831) |
| 1 | HR-characteristic contact bit | measured (electrode CONTACT, not wear) | ✓ | — | — | **09-20: 131 drops, 3.6 h; 233 drops since 08-20** (#2781) |
| 1 | `hr-beats` — HR/RR in the packet | measured (a beat) | ✓ (since #2781) | — | — | — |
| 1 | PPI contact flag | measured | — | ✓ (not in SDK mode) | — | — |
| 2 | ambient level / stability | inferred (optical proxy) | — | ✓ (55 / 176 Hz domains) | — | 08-14: docked Verity 3 h 24 m "worn" |
| 2 | pulse prominence | measured (a pulse) | — | ✓ | — | — |
| — | ring `contact == 1` byte | measured (finger) | — | — | ✓ | ring is never dropped by the daemon; its own idle timer powers it off |
| — | **prose only** — "the H10 runs on a coin cell, so charging is permanently False" (`capture.py:7980`) | prose | ✓ | | | the sentence was true; nothing enforced it |

Two structural facts the table makes visible:

1. **Charging is rank 0 and its inferred form has the same weight as its measured forms.** Fixed for
   the H10 by #2831 (a beat outvotes the *inferred* dock only). Still true for the Verity: a fresh
   Verity flat at 100 % for 45 min on a wrist with no PPI (SDK mode) is judged docked. Measured
   exposure: 0 min so far (the Verity's battery is rarely at 100 % on a wrist), but the shape is the
   09-22 defect with a different device.
2. **The not-worn DROP is keyed on the verdict, and the verdict's rank-1 vote for the H10 is electrode
   contact, which is a quality signal, not a wear signal.** #2781 added the beat vote; before it the
   strap's own 8 242 beats a night could not save the link. The drop has now been disabled once
   (2026-08-11, *"91 events in 7 days"*, `POLAR-ONBOARD-BACKUP-FOLLOWUPS` §1), restored, and has cost
   **698 minutes** since — it is the single most expensive mechanism on the box.

## 3 · What the drop buys, measured against what it costs

The drop's charter (`capture.py` "POWER: drop a not-worn Polar so it stops draining"): a strap off the
body streams noise at 130 Hz and flattens its battery in a day. Measured on this box:

- The H10's cell reads **100 % after 14 nights of streaming** (09-08 → 09-22, `/api/state`); the
  drop has never been the thing keeping it alive.
- The Verity DOES drain (~9 %/h streaming) and does sit in a dock at 100 % — the drop and the
  flat-battery inference were both written for it, and both are correct for it.
- Every false not-worn costs **180 s of night per fire + a 90 s re-check cadence**: a strap judged
  not-worn while worn loses ~⅔ of every minute until the verdict flips. That is the 41 % nights.

So the asymmetry `worn_verdict`'s own docstring states — *"a false NOT-WORN drops a live link and costs
a recording; a false WORN wastes battery and costs a charge"* — has been measured, and on the H10 the
cheap error was made 373 times to avoid an expensive one that cannot occur on a coin cell.

## 4 · Other capture paths, audited by the same method

- **O2Ring:** 14 gap-minutes in 33 nights, none daemon-caused. The ring's own idle timer powers it
  off when not worn (`ring powered off — idle timer`, 162 events) and the box reconnects on wear via
  presence (#2711). Stored-session pulls pause live capture (`pulling stored session — live capture
  paused`, 592 events) and are gated to not-worn; no worn-loss found. **No change.**
- **Verity SDK-mode stalls** (`has been linked but recording nothing for ~N min`, 199 events) and
  the `device stamp ABSENT (zero)` refusals (7 283) are the `unattributed` 204 min — a separate,
  already-rowed lane (`DEVICE-RATE-TRUTH`, `VERITY-*`); not a precedence defect.
- **CPAP:** EDF pulls, not a live link; not in this metric.
- **Daemon restarts** (the hourly updater's idle-restart): the `resuming file-set` machinery keeps the
  file; the gap is the restart itself (~6 s) — below every cadence cut. **No loss.**

## 5 · Remedy — one rule change, the rest is enforcement

**R1 (owner ruling needed).** *The not-worn drop applies only to a device that can charge.* A device
that cannot charge cannot drain to the dock, and the drop exists to protect the dock's charge budget.
For the H10 that means: never drop for power; keep the not-worn VERDICT (it still gates the auto-pull
and the QC line), just not the link. Implementation: `power.drop_not_worn_sec` becomes per-device
via a `can_charge` capability recorded in devcaps (measured: a battery that has ever RISEN or a PMD
`IN_CHARGER` seen for that address; the H10 has neither in 14 nights) — the row
`2026-09-16-devcaps-has-no-branch-consumer` gets its first branch consumer. Until the capability has
been observed for a unit, the drop is OFF for it (absence is `null`, never "assume it charges").
*Alternative the owner may prefer:* `power.drop_not_worn_sec: 0` on vigil for the H10 only — no
code, one config line, same effect tonight, no generality.

**R2.** The flat-at-100 % inference is gated the same way: it may only fire on a unit with observed
`can_charge`. Closes the Verity's copy of the 09-22 defect before it costs a night.

**R3.** `worn_verdict`'s votes carry their source (`measured` / `inferred`) as data, not as comments,
and an inferred vote never outranks a measured vote of the opposite sign — the general rule of which
#2781 and #2831 were two instances. The precedence in §2 becomes a table in `telemetry.py` that a test
prints and a doc-gate diffs against this brief.

**R4.** The instrument ships: `capture-host/tools/capture_loss_audit.py` (the §0 metric over every
night on the box, attributed by journal), run by the nightly QC and written beside QC-SUMMARY.json as
`LOSS-AUDIT.json` with a `tepna.verdict/1` (`gate: night-loss`, criterion: worn-but-not-recorded ≤ 5 %
of worn minutes). A night the daemon itself tore is then a FAIL with `daemon:` named in the result —
the tripwire that would have caught 09-03 (25 fragments) eighteen nights before 09-20.

## 6 · Done when

- [x] Owner ruling on R1 (capability-gated drop vs config-off on the H10) — **"Per-unit can-charge capability"**, 2026-09-22.
- [x] R1–R2 built and gate-tested with the 09-21/22 shape as the plant (a full flat battery + a beat
      on a unit with no observed charge ⇒ worn, no drop, no inference) — 2026-09-22, the Verity-in-SDK-mode plant too.
- [ ] R3: the precedence table is code + a printed test artefact; this brief's §2 is diffed against it.
- [ ] R4: `LOSS-AUDIT.json` beside every night's QC summary; the 09-20 and 09-21 nights re-audited
      read FAIL with `daemon:not-worn drop` as the named cause.
- [ ] Re-measured after 14 nights: daemon-caused gap minutes on both Polars = 0.

The general half of #2831's row (`2026-09-22-inferred-dock-outranked-the-heartbeat`, sourced to
`telemetry.py`) is what R1/R2 execute; that row closes on the PR that lands them.
