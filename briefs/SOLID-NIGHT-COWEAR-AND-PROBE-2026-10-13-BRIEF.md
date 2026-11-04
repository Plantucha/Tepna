<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-10-13 (**TRIAGED 2026-11-04 (Heron, box read-only + tree; rule 0: "solid night cowear probe stage lab O2Ring presence trigger radio delay floor vigil coexistence brief status"), acceptance item by item.** **(1) MET AS TO THE BAND, MIS-STATED AS TO THE TALLY:** the box re-judged 2026-10-05 `PASS`, and its own loss audit holds nine ring gaps summing to `1940.0` s, every one of them before co-wear start 22:19:59. The acceptance text pre-stated `gaps: 6` and `seconds: 1830`; the six count the 20:24 to 21:41 cluster, whose own sum is `1347.0` s, and three later gaps (21:56:09, 22:06:01, 22:10:11, each over a `daemon:restart` in-gap event) were missed when the brief was written. Co-wear start is the H10's first ROW, so the brief's 22:17 is that file's name stamp and its first ECG row reads 22:19:59. The code is right and the pre-stated numbers were eyeballed. **(2) MET:** 2026-10-13 reads `NOT_APPLICABLE` with the reason `probe night: declared by journal heap-probe ARMED at 2026-10-13T14:36:14`, and the run skips it: `first` stays 2026-10-04 across the 10-12 and 10-13 probe nights while `solid` goes from `8` to `9`. `nights` and `days` grow by the skips BY DESIGN (`consecutive()`'s own docstring keeps a run stretched by weeks of skips visible), and `exit` reads `solid` alone, so a declared probe night cannot block the exit. **(3) OPEN, and the only open item:** no monitor-written marker exists on the box. 2026-10-13's `PROBE-NIGHT.json` reads `by: "reinstate: journal confirms ARMED"`, and no night folder holds an `on: false` state, so the toggle has never run end to end. The code and its tests ship (`probe_night.py`, `webmon.py`, `test_monitor_probe_night.py`, `test_webmon_probe_night.py`), so what remains is one on-box exercise, and that is a WRITE on the production host during capture: the owner's or the resident's call, not a rig session's. **(4) MET 2026-11-04:** `capture-host/check.sh` over this very tree, the one that merged as 8162fb3dc, reads `EXIT=0`, `TOTAL … 100%`, verdict `PASS`. **(5) MET WITH NO MANUAL STEP:** the box already carries the code — deployed `probe_night.py` dated 2026-10-13 19:56, and the deployed `solid_night.py` carries `pre_cowear` — so the walker's update path discharged the deploy. **(6)** therefore rests on the one open item above, and on nothing else.) · **Created:** 2026-10-13

# SOLID-NIGHT: a gap before co-wear is coverage, and a probe night is declared

**Owner, 2026-10-13 16:4x EDT**, on the 10-05 FAIL (ring: 6 unattributed gaps, 1830 s, all between
20:24 and 21:41, before the H10 joined at 22:17): *"it was testing, probing. we should include some rule
that can recognize that, like if there is multiple disconnect before other devices join, because holes
only matters if you cant compute together with other devices."* Then: *"build it now, possibly with
manual button to turn night to probe on/off."* Lane: Heron (capture-host + box). Amends
`SOLID-NIGHT-2026-09-23-BRIEF.md` §3.3/§3.4; that brief stays the reference.

## 1 · The scored interval starts at co-wear

- **Rule.** For every continuity band, the scored interval of a device is `[max(worn start, co-wear
  start), worn end]`. **Co-wear start** is the latest first row among the night's expected devices that
  recorded this night (the declared list, SOLID-NIGHT §2, never the folder). The worn ends stay as §3.3
  and A1 define them.
- **A gap before co-wear start reduces coverage and never decides a band** (§∅ owner ruling
  2026-09-17: a discontinuity refuses, reduced coverage annotates). The device's result carries it as
  `pre_cowear: { gaps, seconds, from, to }` so the verdict says what it did not score.
- **One expected device recorded** → co-wear start is undefined, the scored interval is the worn
  interval unchanged, and the result says `cowear: "single device"`. An expected device that never
  recorded is already its own outcome (§2); it does not move co-wear start.
- **Measured on 10-05** (box `LOSS-AUDIT.json`, read 2026-10-13): ring worn from 20:19, H10 from 22:17,
  Verity from 22:17; the ring's six gaps lie 20:24–21:41, each spanning a `daemon:restart` or
  `daemon:pull paused live` in-gap event from the owner's evening probing; the ring's 22:17→04:20
  stretch carries no gap. Under this rule the night reads PASS with six gaps annotated.

## 2 · A probe night is declared, never inferred

Two declarations, either one suffices; the reason names which:

- **Journal.** The daemon start that covers the night logged `heap probe: ARMED` (`capture.py`
  `consume_heap_request`). The probe injects event-loop stalls of 1–12 s on purpose (measured: 25 stalls,
  58 of 64 H10 gaps over 1 s inside the traced window, `capture.py:12033`), so the judge cannot score the night
  solid or not solid.
- **Manual toggle.** A button on `monitor.html` (the capture-host API, port on the box) turns the
  current night's probe flag on or off. On writes `PROBE-NIGHT.json` into the night folder:
  `{ "on": true, "at": "<ISO>", "by": "monitor" }`. Off rewrites it with `"on": false` and the
  time, so the toggle records the change and never deletes it (captured bytes and their sidecars are immutable;
  correction lives beside, dated). The chip shows the current state; `find_unwired` must see every
  forwarded field drawn.
- **Verdict.** A declared probe night is `NOT_APPLICABLE` with the reason
  `probe night: declared by <journal heap-probe ARMED at …|monitor toggle at …>`. The run
  (`consecutive()`) **skips** it: it neither extends nor resets the streak. A toggle turned off with no
  journal declaration leaves the ordinary judge in force.
- Nothing here infers a probe from the data (owner, 2026-10-12: stop inferring). A night with probe-shaped
  gaps and no declaration fails as today.

## 3 · Acceptance

1. 10-05 re-judged → `PASS`, `pre_cowear.gaps = 6`, `pre_cowear.seconds = 1830`.
2. 2026-10-13 (tonight, PID 854652 armed at 18:36:15Z) re-judged → `NOT_APPLICABLE`, reason names
   the journal line; the streak file shows the night skipped.
3. Toggle on → `NOT_APPLICABLE` by the marker; toggle off → the marker reads `on: false` and the ordinary
   verdict returns; both states visible on `monitor.html`.
4. `capture-host/check.sh` green (100 % branch coverage, `find_unwired --check`, ruff, shellcheck, mypy
   baseline); the mutation gate on `solid_night.py` + `solid_night_inputs.py` within the 45 min cap.
5. Deploy is owner-authorized. 🔴 A daemon restart tonight consumes the armed probe (the request arms at
   start only), so the code lands on main tonight and the box takes it on the morning restart unless the
   owner says otherwise; the judge re-runs 10-05 and 10-13 read-only from `/opt/tepna` after the update.
6. Status → DONE only when Heron measures 1–4 on the box and quotes the two re-judged verdict files.
