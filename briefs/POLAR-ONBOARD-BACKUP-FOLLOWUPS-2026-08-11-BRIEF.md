<!--
  POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS (parked 2026-09-02 — drain triage, Kestrel: §4's CODE is built — the H10 RR-acceptance probe endpoint landed in #2042 (`webmon.py`, second allowlist + readback) — and what remains is the EXPERIMENT on a strapped idle H10, owner-scheduled box time; owner: Heron, next step: run the probe in the Phase B window and write its verdict into §4. Re-verified this date: `power.drop_not_worn_sec` is back at 180 (`capture.py:1791`, `settings_schema.py:34`) so §2's restore step 4 holds. Previously 2026-08-15: **§2 SUPERSEDED** — the blocking state it describes no longer exists, measured on the box; **§3 EXECUTED**. §5 needs no code) · **Created:** 2026-08-11

> **What this is.** What the 2026-08-10/11 hardware session surfaced that the parent brief does not
> cover. Four fixes already shipped; three items remain, and one of them is holding a safety setting
> disabled on the live box. Every number here is measured — the session's own lesson was that the
> unmeasured ones are the dangerous ones.
>
> **✅ THE SAFETY SETTING IS NO LONGER DISABLED — verified on the live box 2026-08-18.**
> `/opt/tepna/capture-host/config.yaml` carries `power.drop_not_worn_sec: 180.0` and
> `not_worn_recheck_sec: 90.0` — and, the half that matters because config presence is not behaviour, the
> journal shows it **firing**: `not worn for 180s — dropping`, **91 events in 7 days** across the two Polar
> devices (H10 7, Verity 84). The sentence above is left standing rather than rewritten: it was true when
> written, and the correction is the useful part.
>
> ⚠ **Check the SYSTEM journal, not the user one.** `journalctl --user -u tepna-capture` returns **0 lines**
> here — the unit is a system service — and a zero from the wrong journal reads exactly like a setting that
> never fires. That misread happened once while verifying this and is recorded so it does not happen twice.

## 0 · The state it leaves the box in

`power.drop_not_worn_sec = 0` on vigil — **the not-worn drop is DISABLED** and stays that way until
§2 lands. That is deliberate: the detector currently reports `worn: False` for a worn armband, and a
drop acting on that reading disconnects a sensor mid-night.

> ### ✅ NO LONGER TRUE — re-measured on the box 2026-08-15
>
> ```
> /opt/tepna/capture-host/config.yaml
>   power:
>     drop_not_worn_sec: 180.0
> ```
>
> The drop is **restored and live**. §2 was discharged by work that landed after this brief was
> written; the state described above is stale, and this box is the first thing a reader trusts. See
> §2-RESULT.

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

### ✅ §2-RESULT — SUPERSEDED, not executed. Verified in the code and on the box, 2026-08-15

Every item §2 asked for exists, and none of it was done by this brief:

1. **"It refuses rather than guesses"** — `telemetry.optical_worn` opens with `if not calibrated_for(fs):
   return None`, and its docstring states the three-valued contract (*"`None` IS NOT `False`, and the
   callers make that distinction load-bearing"*). Done.
2. **"Re-derive per rate"** — done differently and better than asked. Rather than re-deriving the level
   threshold at 176 Hz, a **second detector** was added: `ambient_stability_worn`, because *the pegging
   inverts between the rates* — at 55 Hz worn is dark and unworn is pegged-bright, at 176 Hz worn is
   pegged-and-quiet and unworn is unpegged room light. The level separates at one rate and the variance
   at the other, and each is blind at the other's. That is two physical regimes, not a threshold to
   widen. Calibrated 2026-08-13 on 90 windows from 15 real files, threshold at the geometric midpoint of
   a 3.9× gap — and the write-up says plainly that this calibration is **weaker** than the 55 Hz one
   (90 windows vs 5730, state inferred from capture time rather than known) instead of smoothing it over.
3. **"Prefer the PPI contact bit"** — superseded by a multi-vote `worn_verdict` in which the contact bit
   is one vote among several, with a pulse override that may overrule the ambient proxies but **not** a
   contact bit. That ordering is the right answer to the parent's caveat, and to the observed failure of
   a Verity streaming 3 h 24 m inside its charger under `worn: True`.
4. **"Restore `drop_not_worn_sec = 180`"** — already 180.0 on the box.

**A third detector was tried and REFUTED, and the refutation is recorded so nobody re-derives it.**
Cardiac-band power looks ideal (periodicity is rate-independent) and showed a 94× separation on two
hand-picked windows; over the corpus it is not a detector at all — at 55 Hz, 468 of 474 windows fall in
the overlap, and the unworn *maximum* exceeds the worn maximum. That is the same "two hand-picked
windows nearly became a fleet claim" shape this repo keeps finding, caught before it shipped.

**What this brief contributes is the correction:** §0's banner said a safety feature was disabled and
would stay disabled until this brief landed. It is not, and it did not. A brief that states a live
degraded state is the one a reader trusts most, so a stale one is worse than a stale plan.

## 3 · The SDK-mode switch needs to say what it costs — BEFORE the click

Enabling SDK mode disables PPI and HR on a Verity Sense (parent brief, §"the Verity mode selector").
The monitor presents SDK mode and the PPI/HR stream checkboxes as independent controls, so the config
can express a state the hardware cannot hold, and the only symptom is two streams quietly absent.

**Done when** the SDK-mode control names the exclusion in its help text, and enabling it while `ppi`
or `hr` is checked warns rather than silently winning. Derive the exclusion from the device where
possible; state it as a Verity-family fact where not.

> ### ✅ EXECUTED 2026-08-15
>
> **It cannot be derived, so it is stated.** Nothing in the PMD feature set announces the exclusion —
> the device advertises SDK mode and advertises PPI, and says nothing about the two being exclusive. So
> it ships as a Verity-family fact, in exactly the terms this brief allowed for.
>
> **Three surfaces, because the UI one is the bypassable one:**
> - the control's help text now ends *"**Costs PPI and HR** — a Verity cannot serve those in SDK mode,
>   and they go quiet rather than erroring"*, visible whether or not there is a conflict;
> - a red banner appears on the control when SDK mode is on **and** `ppi`/`hr` are configured, naming
>   the streams — the half you see *before* the click, which is what §3 asked for;
> - `POST /api/settings` returns a **`warnings`** array, and the save message renders it in red. This is
>   the load-bearing half: it is testable, and it fires for a client that never renders the banner.
>
> **It warns, it does not refuse** — deliberately. The exclusion is a family fact, so a hard refusal
> would block a legitimate config written for hardware that does not have it. "Silently winning" was
> the defect, not "permitting".
>
> **The check is on the FINAL state, not on the `sdk_mode` edge.** The conflict arrives from both
> directions, and adding PPI to a device already in SDK mode is the likelier one; an edge-triggered
> check would miss it entirely. That case has its own test, and its own mutant.
>
> **`warnings` is always present, even when empty** — a key that appears only on trouble teaches a
> client to read its absence as "no trouble", which is indistinguishable from a server older than the
> check.
>
> Four tests, each DENY paired with an ALLOW (no conflict ⇒ empty; disabling ⇒ never warns).
> Mutation-verified: dropping the warning, making it edge-triggered, and warning on disable each red the
> intended assertion.

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

> ### ✅ RETRIEVAL HALF EXECUTED 2026-08-18 — the trigger was the whole gap
>
> **Most of this was already built, and the brief's framing hid it.** `pull_polar_offline_all` →
> `polar_offline_op` → `polar_psftp.list_recordings`/`pull_recording` is a complete, working Polar pull,
> and `charger_pull_poller` has listed `Polar` in its vendor set since **2026-07-23** (`3add29bd`) — the
> vendor-scope complaint is true of `autopull_poller`'s hourly path only. So no retrieval code was
> missing. **What was missing was a reachable trigger**: the H10's CR2025 coin cell keeps `charging`
> permanently False, so the on-charger path could never fire for it. Recording without retrieval fills
> the single onboard slot once and then silently records nothing — §0.2's fabricated-absence class.
>
> **`notworn_pull_due(worn, since, now, settle, already)`** is the doff-edge sibling of
> `charger_pull_due`, wired into the same poller as a second trigger. Two things it does deliberately:
>
> - **`worn is False`, not falsy.** `worn` is tri-state and `None` means *no verdict* — no contact bit and
>   no optical inference — where the device may still be on the body mid-recording. This is the same
>   `worn is not False` convention the power drop and `cpap_harvest.blocking_devices` already use, and the
>   test pairs the `None` denial with an explicit-`False` allowance so a predicate that never fires cannot
>   pass.
> - **The settle is CLAMPED above the power-drop grace, not merely defaulted above it.** A pull holds a
>   connection; `should_drop_not_worn` closes one, so firing inside the 180 s grace would block the drop —
>   the one thing this section forbids. Default 300 s, and any config below `_DROP_NOT_WORN_SEC + 30` is
>   raised with a log line rather than obeyed. The drop wins, then the pull reconnects fresh.
>
> **Still open:** the RR-vs-HR acceptance probe (parent §6 Q1) — which this unblocks and does not answer —
> and no H10 pull has yet been exercised against real hardware. The trigger is gate-tested; the round trip
> is not, and that distinction is the honest state.
>
> **✅ THE TRIGGER'S PRECONDITION IS CONFIRMED ON REAL HARDWARE (box journal, 2026-08-18).** A trigger keyed
> on a state the device never reaches would be dead machinery, so it was checked rather than assumed. The
> H10 *does* earn a `worn=False` verdict and *does* drop on it — **7 events in 7 days**, essentially one per
> night, at night-end times (06:03, 06:25, 04:19, 02:10, 04:21). One doff per night is exactly the cadence a
> nightly backup wants, and the clamped settle (≥ `_DROP_NOT_WORN_SEC + 30` = 210 s) places the pull ~30 s
> after that drop, as designed.
>
> ⚠ **THE TWO DEVICES DIFFER 12×, AND THE VERITY IS THE ONE TO WATCH.** Same window: **84** Verity drops
> against the H10's 7 — ~12 per day, consistent with its unreliable contact bit and SDK-mode link churn.
> Each is a fresh doff session, so this trigger would take the connect lock ~12×/day for it. The pulls are
> bounded, connect-locked and idempotent (`pull_session` skips a session already on disk at the same
> device-reported size), so the cost is **lock contention, not duplicated bytes** — but it is a real cost and
> it was invisible before this count. If it proves chatty the fix is a per-device minimum interval between
> doff pulls; **not** widening the settle, which would push the pull back into the power-drop grace it is
> deliberately clamped out of.

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
