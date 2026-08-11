<!--
  POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-11

> **What this is.** What the 2026-08-10/11 hardware session surfaced that the parent brief does not
> cover. Four fixes already shipped; three items remain, and one of them is holding a safety setting
> disabled on the live box. Every number here is measured — the session's own lesson was that the
> unmeasured ones are the dangerous ones.

## 0 · The state it leaves the box in

`power.drop_not_worn_sec = 0` on vigil — **the not-worn drop is DISABLED** and stays that way until
§2 lands. That is deliberate: the detector currently reports `worn: False` for a worn armband, and a
drop acting on that reading disconnects a sensor mid-night.

## 1 · Shipped (context, not work)

| PR | what |
|---|---|
| #1155 | `parse_status_response` parsed a control-point ERROR reply as measurement data — an H10 `ERROR_INVALID_OP_CODE` became `{ppg: "none"}`, a state for a stream that device does not have |
| #1161 | `ppg2w` missing from the O2Ring offer set — not merely un-toggleable, **deleted** by any settings save. Cost 110 MB/night of second-wavelength pleth on 2026-08-10 |
| #1165 | the SDK-mode switch was one-way: "off" meant "stop asking", leaving the device in SDK mode until a manual power cycle |
| #1166 | `chosen_rate` answered "the device does not offer that rate" with `max(rates)` — the Verity ran ACC at 416 Hz for ten hours because its menu has no 50 |

## 2 · The worn detector is calibrated at a rate the box no longer uses — BLOCKING

`optical_worn`'s threshold (5,000) and its worn cluster (129–207) were derived from corpus data at
**55 Hz** PPG. At **176 Hz** the ambient channel reads ~650,800 with a spread of 208 counts — a pegged
value, not a light level — which lands in the old "desk" cluster no matter what. Measured on a worn
armband 2026-08-10: median |ambient| 650,827 while the PPG showed a textbook pulse at ~57 bpm.

Two changes shipped the same day, each defensible alone, and neither checked against the other: PPG
default → 176 Hz in the morning, worn detection calibrated at 55 Hz in the evening.

**Done when**, in this order:

1. **It refuses rather than guesses.** If the negotiated PPG rate is not the one the calibration was
   measured at, publish `worn = None`, not `False`. `None` already means "no verdict" everywhere
   downstream and the UI renders it as its own state. This alone would have prevented the incident,
   and it is a smaller change than re-deriving anything.
2. **Re-derive per rate** from a worn night at each rate the box actually offers.
3. **Prefer the PPI contact bit**, which is rate-independent — with the caveat the parent brief now
   records: Polar documents it as unreliable, failing toward a false `worn`.
4. Only then restore `power.drop_not_worn_sec = 180`.

⚠️ The afternoon measurement that appeared to validate the detector was taken on a genuinely unworn
device, so it agreed for the wrong reason. A passing check on a case that cannot fail is not evidence.

## 3 · The SDK-mode switch needs to say what it costs — BEFORE the click

Enabling SDK mode disables PPI and HR on a Verity Sense (parent brief, §"the Verity mode selector").
The monitor presents SDK mode and the PPI/HR stream checkboxes as independent controls, so the config
can express a state the hardware cannot hold, and the only symptom is two streams quietly absent.

**Done when** the SDK-mode control names the exclusion in its help text, and enabling it while `ppi`
or `hr` is checked warns rather than silently winning. Derive the exclusion from the device where
possible; state it as a Verity-family fact where not.

## 4 · The H10 recording leg — unchanged, and still gated on one experiment

Everything about the H10 is now known except whether it accepts `SampleType.RR` (parent §6 Q1). The
retrieval half is the real blocker and is worth doing first:

- **No pull path reaches an H10 today.** The charger trigger cannot fire — it is a CR2025 coin cell,
  so `charging` is permanently false — and `autopull_poller` is hard-scoped to `Wellue`/`Viatom`.
- **One slot.** A session never emptied blocks the next night silently.
- So recording before retrieval fills the slot once and then quietly records nothing, which is the
  parent brief's own §0.2 fabricated-absence class.

**Done when** an H10 pull exists (extend `autopull_poller` past its vendor scope, plus a bounded
not-worn-edge pull that never blocks the drop), and only then the RR-vs-HR acceptance probe — through
`polar_offline_op`, which owns the connect lock and bonds, not a standalone script.

## 5 · Two process findings, both of which cost real time

**A fake written by reading the implementation encodes the implementation, bugs included.** Fixing
`parse_status_response` exposed *three* fakes emitting a short control-point envelope — 3 and 4 bytes
where the wire uses 5 — every one of which had passed for years. A fourth, `FlexPolarClient`, did
`op, meas = cmd[0], cmd[1]` and IndexErrored on any parameterless op, silently making SDK-mode status
(0x06) and measurement status (0x05) untestable through the fake every runner test uses. Only going to
the SDK source broke the circularity; "fixing" the parser to match its tests would have made it worse.

**A gate you did not run reports nothing, and nothing reads as success.** `pytest` without `--cov`
emits no coverage table at all, so a 3,264-test pass looked like a green gate while the 100 % floor CI
enforces had never been evaluated. The absence of a `TOTAL` row is the tell. Use `./check.sh`; it
exists for this and its own header describes the same failure.

## Done when

§2 lands and `power.drop_not_worn_sec` is restored; §3 ships with the UI warning; §4 has a working H10
pull. §5 needs no code — it belongs in whatever the next audit charter reads.
