<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS (owner-ordered 2026-09-22 — *"do deep audit of logic for all devices how data is captured, this data loss is unacceptable"*; §1–§4 are the audit, measured on the box. **Owner rulings 2026-09-22 (relayed by Kestrel, option labels verbatim): R1 = "Per-unit can-charge capability"; R2–R4 = "Yes, all three".** R1 + R2 BUILT the same day (`should_drop_not_worn(can_charge=)` reads devcaps `can_charge`, recorded where a charge is MEASURED — `battery-rose`, `pmd-in-charger`; absent ⇒ never dropped, and the flat-at-full inference never fires); R4 BUILT (`loss_audit.py` + `capture.loss_poller`: LOSS-AUDIT.json + LOSS-VERDICT.json per settled night, gate `night-loss`; UNKNOWN with the number until the owner sets a bar — none ruled; re-run on the box's 09-20 / 09-21 nights: 210 / 244 daemon-caused minutes, `daemon:not-worn drop` named); R3 BUILT (`telemetry.WORN_VOTES` — every vote, its rank and whether it MEASURES wear or INFERS it; `worn_verdict` reads the table instead of naming `flat-at-full` inline; §2a is rendered from it and diffed by `test_worn_precedence`). All four rulings executed 2026-09-22) · **Residue:** 2026-09-23-loss-audit-cannot-attribute-a-night-with-no-file · **Created:** 2026-09-22

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

## 1a · ⚠️ WHAT ACTUALLY CAUSED 09-20 AND 09-21 — measured 2026-09-22, and it is NOT the contact bit

This brief was written with the 09-20/21 fragmentation attributed to the HR characteristic's
skin-contact bit reading 0 on a dry strap (§2 rank 1, and the `2026-09-21-…-contact-bit-over-the-
heartbeat` row). **The owner corrected the premise — the electrodes are gelled — and the box agrees
with the owner.** Three measurements, none of which was taken when this brief was written:

1. **The electrodes were fine.** Every HR row on both nights carried a beat: **0 rows of HR = 0** out
   of 9 382 (09-20) and 11 824 (09-21), with 8 242 and 11 589 RR intervals. A dry or lifting
   electrode reports zeros; there are none. An off-body strap reports HR 0 — this brief says so
   itself, and then did not check.

2. **The drops start at a FIXED OFFSET, which contact cannot produce.** ECG 09-20 opens 22:36:24 and
   the first drop is 23:26 (**49.6 min**); ECG 09-21 opens 21:19:02 and the first drop is 22:08
   (**49.0 min**). The flat-battery rule's own arithmetic is `_BATT_FLAT_CHARGING_S` 2700 s + the
   180 s drop grace = **48 min**, plus one battery-poll interval. Skin contact is not clocked;
   nothing about adhesion begins at 48 minutes on two separate nights.

3. **The trigger is in the night files, in a column nobody had read** — `battery_pct` in the box-wide
   `Tepna_*_LINK.csv`. The H10's coin cell reads **10 %** on every night from 09-14 to 09-19, and
   **100 %** from its first connect of the 09-20 night (`2026-09-20T22:36:36.813`, twelve seconds
   after that night's ECG file opens). The owner had fitted a **higher-capacity cell**, chosen so the voltage does not sag — and ~400 h is the STANDARD cell's rating, so the fitted one holds its level flatter and for longer than that.

So the cause is the rank-0 **`charging` — flat at 100 % for 45 min** inference, written for the
Verity's dock and calibrated on its 9 %/h drain, firing on a coin cell that cannot move. It outranks
every other vote, so the contact bit's reading that night is not merely unproven — it is
**irrelevant to the outcome**, and it is also **unknowable**, because the bit is persisted nowhere.

⚠️ **THE RULE PENALISES A BETTER BATTERY, and that is the general defect.** It reads "the level has
not moved in 45 minutes" as evidence of a charger. A long-life cell's whole virtue is that the level
does not move. The standard cell is rated ~400 h and the fitted one exceeds it, so flat-at-100 % is not
a transient to wait out — it is the device's normal condition for weeks, and the better the cell the
longer the rule stays wrong. The H10 was protected from this rule for months by its own dying cell —
the readings fluctuated 10 → 20 → 30 under load — and lost that protection the moment it was given a
better one. #2831/#2833 gate both the inference and the drop on a MEASURED `can_charge`, and the
H10's devcaps record has none, so neither can fire on it now; but the premise remains false for any
device whose battery is simply good.

## 2 · The precedence table — how each device is judged "worn", by source

`telemetry.worn_verdict` combines votes; `capture._publish_worn` feeds `_WORN_SINCE`; after 180 s of
continuous not-worn (`power.drop_not_worn_sec`) the Polar runner DROPS the link and re-checks every
90 s. The drop never fires on `worn = None`. Every vote, in the order it decides:

| rank | vote | source | H10 | Verity | O2Ring | cost when wrong |
|---|---|---|---|---|---|---|
| 0 | `charging` — battery ROSE | **measured** | n/a (coin cell) | ✓ | ✓ (`batt_state`) | none seen |
| 0 | `charging` — PMD `IN_CHARGER` | **measured** | n/a | ✓ | — | none seen |
| 0 | `charging` — flat at 100 % for 45 min | **inferred** (written for the Verity's dock) | ✓ fires! | ✓ | — | **09-21/22: 140 drops, 3.6 h** (#2831) |
| 1 | HR-characteristic contact bit | measured (electrode CONTACT, not wear) | ✓ | — | — | **233 drops since 08-20** (#2781). ⚠️ The 09-20/21 nights are NOT this row — see §1a: rank 0's flat-battery inference fired at 48 min on both and outranks it |
| 1 | `hr-beats` — HR/RR in the packet | measured (a beat) | ✓ (since #2781) | — | — | — |
| 1 | PPI contact flag | measured | — | ✓ (not in SDK mode) | — | — |
| 2 | ambient level / stability | inferred (optical proxy) | — | ✓ (55 / 176 Hz domains) | — | 08-14: docked Verity 3 h 24 m "worn" |
| 2 | pulse prominence | measured (a pulse) | — | ✓ | — | — |
| — | ring `contact == 1` byte | measured (finger) | — | — | ✓ | ring is never dropped by the daemon; its own idle timer powers it off |
| — | **prose only** — "the H10 runs on a coin cell, so charging is permanently False" (`capture.py` `notworn_pull_due`) | prose | ✓ | | | the sentence was true; nothing enforced it |

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

### 2a · The same table, as DATA — `telemetry.WORN_VOTES` (R3)

§2 above is the audit's reading, per device. This is the machine's copy: every vote `worn_verdict` can
emit, its rank, and whether it MEASURES wear or INFERS it. It is rendered from the code by
`telemetry.precedence_table_md()` and diffed against this block by
`tests/test_worn_precedence.py::test_the_brief_carries_the_table_the_code_renders` — a vote added in
code without a line here, or a line here with no vote, reds by name. The rule it exists to enforce,
the general form of #2781 and #2831: **an inferred vote never outranks a measured vote of the opposite
sign** (today that binds at `charging`, where an inferred dock yields to a heartbeat and a measured
charge does not; an UNATTRIBUTED charging flag is not an inference and keeps its authority).

| rank | vote | source | means |
|---|---|---|---|
| 0 | `charging:rising` | measured | the battery ROSE — cells do not self-charge, so the device is on a charger |
| 0 | `charging:pmd-in-charger` | measured | the device's own PMD answered IN_CHARGER to a stream START |
| 0 | `charging:flat-at-full` | inferred | a battery flat at 100 % for 45 min — a dock, OR a fresh coin cell (2026-09-22: 140 drops) |
| 1 | `hr-contact-bit` | measured | the HR characteristic's skin-contact bit — electrode CONTACT, not wear (§1a: it did not cause 09-20) |
| 1 | `hr-beats` | measured | a plausible rate or any RR interval in the HR packet — a beat |
| 1 | `ppi-contact` | measured | the PPI frame's contact flag (absent in SDK mode) |
| 2 | `pulse-prominence` | measured | a pulse in the PPG — perfused tissue |
| 2 | `ambient-level` | inferred | ambient light dark enough to look like skin (55 Hz domain) |
| 2 | `ambient-stability` | inferred | ambient light steady enough to look like skin (176 Hz domain) |

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
- [x] R3: the precedence table is code (`telemetry.WORN_VOTES`) and §2a is its rendering, diffed by
      `test_worn_precedence.py` — a vote added in code without a brief line reds by name; the rule
      "an inferred vote never outranks a measured vote of the opposite sign" is a test, not a comment — 2026-09-22.
- [x] R4: `LOSS-AUDIT.json` beside every night's QC summary; the 09-20 and 09-21 nights re-audited
      name `daemon:not-worn drop` as the cause (210 / 244 daemon-caused min) — 2026-09-22. They read UNKNOWN,
      not FAIL: no bar has been set (owner), so the object carries the number and refuses to judge it.
- [ ] Re-measured after 14 nights: daemon-caused gap minutes on both Polars = 0.

The general half of #2831's row (`2026-09-22-inferred-dock-outranked-the-heartbeat`, sourced to
`telemetry.py`) is what R1/R2 execute; that row closes on the PR that lands them.
