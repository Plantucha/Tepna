<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS — 2026-09-23 (owner-ratified programme; assignments issued the same evening; the first ranking below is measured from the box's own loss audits, the verdict is Magpie's unit; **§3's bands STATED 2026-09-24 (Magpie) before any night is scored** — the verdict's code in `nightqc.py` and the monitor line are next, and Wren refutes the judgement bands against the re-audited 28 nights first) · **Created:** 2026-09-23 · **Relates:** `STRATEGIC-PRIORITIES-2026-08-26-BRIEF.md` (P1–P4 deferred by this programme; P5's "two error-free weeks" is this programme's exit) · `OPERATIONAL-MATURITY-ROADMAP-2026-08-27-BRIEF.md` · `ABSENCE-SURVEY-2026-09-22-BRIEF.md` (the one processing lane that continues) · `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` · CLAUDE.md §∅ and §🔒 §7

# SOLID NIGHT — capture quality first, scored by one nightly verdict, exit at fourteen consecutive solid nights

## 0 · The ruling, verbatim (owner, 2026-09-23 ~19:20)

> "Have good processing is good. But if I feed it with junk fragmented not time aligned data any output
> will be also junk. So I think we have to first focus on capturing solid high quality data then
> refocus on processing. After we have solid product we can play with us and ui, storage, security,
> this is not product so sale so we have not any community at time restrictions pressure."

Allocation: "2x coders work on capture 1x on processing, Kestrel coordinator and can do whatever looks
most productive." On the bird mapping in §4: "Sounds good to me."

The argument was run both ways before the ruling and is recorded so it is not re-litigated:

- **Against capture-first:** the absence survey's 290 confirmed defects were ALL path-manufactured in
  processing (an absent read folded as "nothing there", a defaulted rate spent as a timebase); capture
  quality is invisible without honest processing (the 10-minute stall went four nights unseen because
  every downstream number stayed computable and green); capture has a physical ceiling; a "first"
  phase without an exit never ends.
- **For capture-first:** captured bytes are immutable and irreplaceable, processing is replayable on
  any later day — effort on the irreplaceable side compounds; every defect found this week was
  capture-side (the stall, the H10 flat-battery drop, Verity drop-outs, the ring's in-band zeros, the
  AS11 clock); the trio corpus is the asset and its eligibility losses are all capture.
- **Fusion (what this brief is):** the asymmetry wins, so capture first — but "quality" is DEFINED as
  a per-night verdict with pre-stated bands so the phase has an exit, and the processing that
  MEASURES capture (refusal semantics, coverage, the verdict itself) is part of capture, not a detour.

## 1 · Motivation, measured

Two hundred merges 2026-09-20 → 09-23, counted by title: tools/gates/guards/verdicts/hooks **94**,
docs/residue/briefs 53, capture-host 43, absence refusals 36, node analyzers 24; touching P1 interop
**4**, P3 provenance export **4**, P4 longitudinal change detection **0**. Three quarters of the
fleet's output was the repo instrumenting itself. Some of it was earned (the guards caught real
defects the day they were built), none of it changed what reaches the owner in the morning.

## 2 · A SOLID night — the criteria (bands are §3's job, not this section's)

One `tepna.verdict/1` per night, gate `solid-night`, written beside the existing `QC-VERDICT.json`,
`BACKCHECK-VERDICT.json`, `ADAPTERHCI-VERDICT.json` and `LOSS-AUDIT.json` — it COMPOSES them, it does
not replace them — and drawn on the monitor page as one line per night. Per configured stream:

1. **Continuity.** Every gap named and attributed to one of: link drop · box stall · device blanking ·
   doff · unattributed — counted ONLY inside the worn interval, which is taken from the device's own
   beat evidence, never from the file span (§5, the Verity 09-12 case). An unattributed gap above the band is not solid; a named, attributed one is
   judged by its class. Gaps are COUNTED as well as summed — the 09-22 stall cost 2–5 s every 10.7 min,
   small minutes and a broken axis.
2. **Timebase.** Host-anchored (`hostAxis` with `independent: true` where a second clock exists),
   every resync seam recorded, ppm within the §🔒 §7 bound, no step absorbed into a slope.
3. **Completeness.** Rows against expected rows for the stream's rate and the night's span.
4. **Validity.** The `…RUNS.txt` sidecar present for every stream that has a writer. An ABSENT sidecar
   is validity UNKNOWN, never "no absences" (#2950's contract); an EMPTY one is the informative
   opposite.
5. **Clocks.** Every device clock offset against the host known (AS11: the `AS11CLOCK.csv` sidecar;
   Polar/ring: the host-axis anchors).

Two facts measured on the box the night this was written, both binding on the verdict:

- **The settle trigger.** The loss audit for night N cannot exist until night N+1's capture starts —
  the QC poller rewrites verdicts into N's folder, `active_nights` reads any file mtime as activity,
  `_current_night` keeps picking N until N+1 holds data. So night N is **UNKNOWN with reason
  `not settled`** until N+1's first data write; never "not solid", never PASS. Pre-registered
  acceptance (Wren): the audit lands ≤ 55 min after the next night's first ECG write.
- **Expected streams come from a declared list, not from what was captured.** The COOSPO 808S has
  zero files on every night and the audit reports `no primary stream known for model 'HRM808S'`;
  the owner ruled it a manual-only backup (§6): NOT expected unless entered into that night's
  capture, so it cannot make every night UNKNOWN by construction.

**Exit criterion: fourteen consecutive SOLID nights** — the owner's own P5 bar ("not until we have
some 2 weeks without errors"). When it holds, the fleet refocuses on processing with a corpus worth
processing. A night absent outright (no file for an expected stream) is its own class and breaks the
run.

## 3 · Bands — STATED (Magpie, 2026-09-24), before the first night is scored

Stated before any night is scored, per memory `pre-state-the-threshold`. The coordinator's draft
(kept below as §3.6 for the record) was the input. Every band carries its **basis**, labelled
**measured** (a number taken from §5 or §🔒 §7) or **judgement** (a pre-stated call nobody has measured
yet). Judgement bands are the ones Wren refutes first, against the re-audited 28 nights (§3.5). **A
band changed after nights are scored is recorded as a change with its reason — never re-tuned silently
until a night passes.**

### 3.1 · Status of a night, and the consecutive count

One `tepna.verdict/1`, gate `solid-night`, over the night's **scored devices** (§3.2). Precedence,
first match wins:

1. **UNKNOWN, reason `not settled`** — until night N+1's first data write (§2's settle trigger). This
   overrides everything below.
2. **FAIL** (not solid) — any scored device FAILs any criterion. A clear failure is not hidden behind
   another device's UNKNOWN.
3. **UNKNOWN** — no FAIL, but some criterion on some scored device could not be decided.
4. **NOT_APPLICABLE** — every expected device is NOT_APPLICABLE (nobody wore anything, witnessed).
5. **PASS** (solid) — every scored device passes every criterion.

Population as an equality: `scored + not_applicable = expected` (memory `gate-must-publish-its-denominator`).

**The consecutive count** runs over **settled** nights in date order: PASS adds one; NOT_APPLICABLE
**skips** (neither adds nor resets — a no-wear night is unfixable, and resetting on it would make the
exit unreachable); **FAIL resets; a settled UNKNOWN resets.** A night we cannot assess is not a solid
night, and letting it bridge a run would fabricate continuity (CLAUDE.md §∅). The latest, unsettled night
is **pending** — excluded, not counted and not resetting. The exit reads **"14 solid of N nights over D
days"**: N = settled nights from the run's first PASS to its last (PASS + NOT_APPLICABLE), D = calendar
days first → last, so a run stretched by weeks of skips stays visible.

### 3.2 · Which devices are scored

- **Expected list, per night:** the night's own capture device set, minus devices marked backup/manual
  (§6: the COOSPO is expected ONLY on a night it was manually entered, then scored like the H10's RR).
  Never a static config, never "whatever happened to be captured".
- **Per expected device — NOT_APPLICABLE (no-wear)** needs one of: **device-positive evidence** for THAT
  device (Verity `in_charger`, the ring's "wear it finger-in", a device that connected and returned a
  non-pulsatile signal), **or** a sibling that connected **on the same sensor pin in the same daemon-start
  segment** (the pin is set once per daemon START, not per night — §5). The witness is per device.
- **Absent with neither** ⇒ **UNKNOWN**, reason `no-wear or radio down — indistinguishable`.
- **Absent with box-failure evidence** (daemon down, adapter down on its pin, started-and-torn) ⇒ **FAIL**.
  Only this class is a defect.

### 3.3 · The worn interval — and why both of its ends need evidence

> ⚠️ **AMENDED 2026-09-24 — see §3.7 A1, forced by night 09-23.** "Beat evidence" below is not enough: a
> beat row exists whether a heart or noise produced it. The interval comes from WEAR evidence (motion,
> orientation, signal amplitude against the night's own baseline). The text below is kept as stated.

Loss is counted only inside the worn interval, taken from the device's own beat evidence (§2, the Verity
09-12 case). ⚠️ **The END of that interval has the same flaw the no-wear rule fixed:** "last pulsatile
window" looks identical when the wearer took the device off and when the device or its link died. A
Verity that dies at 02:00 while the H10 beats on to 07:00 would read as doff at 02:00, and the night
would score solid over five hours of lost data. So:

- **Start** — the first pulsatile window. A device that connected earlier but was non-pulsatile
  (09-12: PPG autocorrelation 0.1, PPI `received no rows`) is carrying its own not-worn evidence.
- **End** — the tail after the last pulsatile window is **`doff`** (not counted) only when there is
  **device-positive doff evidence** (`in_charger`, "finger-in", lost contact), **or** when the device
  ends within **30 min** (judgement) of the last body-sibling to end **and** box-side evidence shows the
  radio stayed healthy past that point (ADAPTERHCI clean, the daemon alive and polling).
- **Otherwise the tail is UNKNOWN for that device**, reason `doff or loss — indistinguishable`. The
  second clause matters too: every device ending together is what waking up looks like, and also what a
  box crash looks like. Without radio-health evidence past the common end, the two cannot be told apart.

**This replaces the draft's night-level "span ≥ 4 h".** Span length is a fact about sleep, not capture —
a short night captured completely is solid — and the thing the 4 h bar guarded against, a device dying
early, is what this rule catches directly. The 4 h bar would also have passed a device that died at
hour 5.

### 3.4 · The bands (per scored stream, inside its worn interval)

| criterion | PASS | FAIL | UNKNOWN | basis |
|---|---|---|---|---|
| **continuity — daemon regression** | none | any minute **inside the worn interval** in `daemon:pull paused live`, `daemon:clock re-sync`, `daemon:stream stall re-negotiate`, `daemon:restart`, or `daemon:not-worn drop` | loss audit not settled; or the audit's `journal` is `unavailable` (then no gap can be attributed at all) | **measured:** §5's re-audit puts every daemon class in 28 nights down to a mechanism already fixed (#2833 not-worn drop, #2459 re-sync, #2982/#2983 pull pause, #2936 stall) **or to correct behaviour** — so only the fixed-mechanism classes are regressions when they recur. **NOT counted:** `daemon:charging hold` (the device reported charging — device-positive doff evidence, correct behaviour) and any `daemon:not-worn drop` OUTSIDE the worn interval (09-12, correct). A restart is idle-gated (`2026-09-10-daemon-restarts-are-idle-gated`), so one that tore a worn recording is a defect. |
| **continuity — unattributed** | total < 60 s **and** count < 5 | total ≥ 60 s **or** count ≥ 5 | — | **measured + judgement:** the 09-22 stall tore 2–5 s every 10.7 min — ~45 gaps a night at only 2–4 min — so the COUNT leg catches a stall-shaped defect the minutes would pass; H10 own residual loss is ~67 min over 28 nights (§5). The count of 5 is judgement. `unattributed (no journal)` is **not** this class: it is the instrument unable to look, and routes to UNKNOWN above. |
| **continuity — link drop** (`link:*` classes) | < 1 % of the worn interval | ≥ 1 % | — | **judgement, new:** the draft allowed any amount; an hour of link drops is not solid capture whatever it is called. Historic link loss is ~0.2 min/night (ring timeout 0.7, H10 re-negotiate 5.4, over 28 nights), so 1 % (~5 min on 8 h) is ~25× headroom. ⚠️ `link:dbus busy` (BlueZ `InProgress`) is the box's own stack, not radio physics — kept under this bound for now, and the first class Wren should test for moving to the regression row. |
| **continuity — device blanking** | — | — | — | judged under validity (the sidecar), not here |
| **timebase** | `hostAxis` ok; every resync seam recorded; only post-seam anchors fed (§🔒 §7); box capture carries `independent: true` | `hostAxis` refused with ≥ 3 anchors; a step (`maxStepMs`) > 1000 ms that is not a recorded seam; a box capture with `independent: false` (a derived host column) | < 3 anchors | **measured:** BLE delivery jitter ~0.1 s, 470 ms worst observed (§🔒 §7), so a step above ~2× the worst jitter is a real step, not jitter. The draft's bound of 50 000 ppm (absolute) is `hostAxis`'s own refusal bound, already implied by "ok". |
| **completeness** | 99 % – 101 % of `negotiated rate × worn-interval seconds` | < 99 %, or > 101 % | negotiated rate not written beside the stream (#2912) — never fall back to the nominal rate, a drawn axis | **measured + judgement:** a healthy H10 night reached 0.999 (09-22 witness), so 99 % is ten times the healthy shortfall. Over 101 % is judgement: rows beyond the rate mean duplicates or a wrong rate, a class `CAPTURE-HOST-DEEP-AUDIT` found on real nights. |
| **validity** | the `…RUNS.txt` sidecar present for every stream that has a writer (present-and-empty = verified no absences) | — | sidecar absent (never FAIL, never PASS — CLAUDE.md §∅, #2950) | Blanking the sidecar records does NOT make a night not solid: the ring's in-band blanking is device behaviour made visible (§5 item 5), and consumers exclude it. |
| **clocks** | offset vs host known for every scored device (`AS11CLOCK.csv`; host-axis anchors for Polar / ring) | — | any scored device without an offset | criterion 5 |

> ⚠️ The **completeness**, **timebase** and **validity** rows are AMENDED by §3.7 A2, A3 and A4 (all forced by night 09-23), and the **timebase** row again by **A5** (the step band, measured over 36 clean nights).

**Inputs are read by exact name** — `QC-VERDICT.json`, `BACKCHECK-VERDICT.json`,
`ADAPTERHCI-VERDICT.json`, `LOSS-VERDICT.json`, `LOSS-AUDIT.json` — **never by glob.** The re-audit left a
pre-#2977 copy of each audit beside the live one (`LOSS-AUDIT.prev-2026-09-23.json`); a
`LOSS-AUDIT*.json` glob would read the blind instrument. Checked 2026-09-24: every existing consumer
already uses the exact name. **An unreadable input is UNKNOWN for the criteria it feeds, never PASS.**
**Journal evidence keys on specific events, never on line counts** — 09-18 carried 206,800 `CPAP
durable sink failed` lines (99.6 % of the journal) from a log line firing on every SUCCESSFUL write.

### 3.5 · How a band is refuted

Wren scores the re-audited 28 nights against §3.4 **by hand**, before the verdict code runs on them. A
band is refuted when a night that the ground truth says is solid FAILs it, or a night with a known defect
(08-27 Verity, the 09-19 → 09-22 stall) PASSes it. Changes go in as an amendment below the table with
the night that forced them — not as a silent edit. The 30-min tail tolerance, the unattributed count of
5, the 1 % link bound and the 101 % ceiling are the judgement calls, and are expected to move.

### 3.6 · The coordinator's draft (input, superseded by §3.4)

Kept so the changes are visible: `continuity` unattributed < 1 min and < 5, link/doff any · `timebase`
ok with |ppm| < 50 000 · `completeness` ≥ 99 % · `validity` sidecar present · `clocks` offset known ·
`night` every expected stream present with span ≥ 4 h. **Changed:** span ≥ 4 h → the corroborated worn
interval (§3.3); "any box-stall gap" → the named fixed-mechanism `daemon:*` classes inside the worn
interval, with `daemon:charging hold` as doff evidence (an earlier cut of this section FAILed every
`daemon:*` minute, which would have convicted correct behaviour — caught before merge by reading the
loss audit's own cause list); link drop "any" → < 1 %; completeness gains a 101 % ceiling; timebase gains
`independent: true` and the > 1000 ms unrecorded-step FAIL, and drops the ppm band implied by "ok";
UNKNOWN gains a count rule (settled UNKNOWN resets the run).

### 3.7 · Amendments — each with the night that forced it

**A1 · The worn interval comes from WEAR evidence, not beat rows** (2026-09-24, forced by 09-23; measured
by Wren, `vigil:/home/vigil/wren-notes/ends.py`). Supersedes §3.3's "taken from the device's own beat
evidence".

- **The measurement.** The H10 was removed 04:21:40–04:22:20 (ACC sd 48 → 269 mG, ECG sd to 8,774 µV) and
  then lay **motionless in a new orientation until the file end, 04:49:57**, still emitting RR — with HR
  climbing as junk, 82 → 172 bpm. An RR, PPI or "pulsatile" row exists whether a heart or noise produced
  it, so beat-row evidence would have credited the H10 with **27½ worn minutes of junk**. It is the same
  both-hypotheses flaw §3.3 fixed at the interval's end, one level deeper: the beat evidence itself does
  not discriminate.
- **The rule.** Both ends of the worn interval come from **wear evidence against the night's own
  baseline**: **pulse prominence** and **motion** (ACC sd), with orientation. A removal signature is a
  step in those, and a strap on a table is flat in motion after it. ⚠️ **Never an ambient-light LEVEL:**
  `telemetry.optical_worn` (ambient < 5000) would NOT have seen 09-23's Verity doff in a dark room —
  ambient went only −185 → −98 (Wren). An ambient STEP can corroborate; a level threshold cannot decide.
  Wren's nightly doff script keys on pulse prominence + motion for the same reason.
- **A removal signature is device-positive doff evidence** for §3.3's End clause 1, alongside
  `in_charger`, "finger-in" and lost contact. All three 09-23 ends carry one, within 04:21:29–04:22:20:
  the Verity's last row at 04:21:42 (ambient sd 38 → 781, PPG ch0 sd 8 k → 372 k, ACC sd 2 → 432 mG in the
  final 10 s); the ring's last SpO₂ row at 04:21:29 then "ring started a new recording session" at
  04:21:40 (finger out); the H10 as above. The 30-min clause stays as the fallback when no signature is
  found.
- **Two inputs this night showed are NOT wear evidence.** (i) The daemon's not-worn detection **did not
  fire** for the H10 in those 27½ min (Wren is filing the row). (ii) The loss audit's `lost_min` measures
  GAPS: its 0.0 for the H10 was right about gaps and silent about wear. The verdict needs both — continuity
  from the audit, the interval from wear evidence.
- **Correction of record.** The verdict's author, reading 09-23 before Wren's measurement, took the H10's
  last RR row as its last worn beat and put the Verity's end **28.1 min** before its sibling — inside the
  30-min clause by 1.9 min. The real spread of the three doffs was **under a minute**. The judgement band
  never decided that night; a phantom sibling nearly did.

**A2 · Completeness is defined for FIXED-RATE streams only** (2026-09-24, forced by 09-23). An event stream
— RR, PPI, HR: one row per beat — carries `# pmd … negotiated=no rate=` **by construction** (09-23's
Verity PPI). Read literally, §3.4 makes such a stream UNKNOWN on every night, so no night could ever PASS:
the same "UNKNOWN by construction" failure the COOSPO ruling was written to prevent. An event stream takes
its completeness from its parent waveform (RR ← ECG, PPI ← PPG) and is not scored for completeness itself.

**A3 · A timebase step is "recorded" if it is in the seam sidecar OR the clock-sync log** (2026-09-24,
forced by 09-23). The capture's seam sidecar records only steps above its own bound — `rule=clock-seam
bound_ms=60000` on every 09-23 stream — while §3.4 FAILs an unrecorded step above 1,000 ms. Read literally,
every 1–60 s step would be "unrecorded" by construction, including the watchdog's legitimate resyncs. Those
land in `CLOCKSYNC.csv` / `Tepna_*_CLOCK.csv`. So: a step above 1,000 ms found in **neither** ⇒ FAIL. Not
yet exercised on a real resync; the unrecorded-step scan is not built.

**A4 · A waveform with no run rule is UNKNOWN, never exempt** (2026-09-24, forced by 09-23). §3.4's
validity row requires the RUNS sidecar "for every stream that has a writer", and `writers.py`'s
`RUN_MIN_BY_STREAM` gives one only to `ppg1`, `ppg`, `ppg2w`, `acc` and `accraw`. Read literally, a
waveform with no run rule is EXEMPT and passes validity having been examined for nothing. The H10's ECG is
exactly that stream, and on 09-23 BACKCHECK found **26 clipped regions** in it: real in-band absences that
no sidecar recorded. So a WAVEFORM stream with no run rule is **UNKNOWN, reason
`no-run-rule-for-stream`** — absence of a writer is not absence of absences (CLAUDE.md §∅). It clears when
the stream gets a rule; Heron has the ECG run sidecar as a writer unit. Event streams (RR, PPI, HR) take
their validity from their parent waveform, as they take completeness under A2.

**A5 · The timebase step band is a PERSISTENT, UNRECORDED shift** (2026-09-24, measured over 36 clean
nights). Supersedes §3.4's "a step > 1000 ms that is not a recorded seam" and specifies A3's measure.

- **Sign convention — binding.** Residual = **host ARRIVAL time − device time**, one value per BATCH anchor.
  The Polar `Phone timestamp` is synthesised per row (batch arrival + k/fs, rounded to 1 ms), so anchors
  are batch boundaries — about 73 rows, ~0.56 s at 130 Hz — not rows. A **negative** persistent shift is
  the device moving forward relative to the host: the normal watchdog resync of a device that fell behind.
  A **positive** one is the host moving forward or the device moving back — a different mechanism at the
  same magnitude, which is why the sign belongs in the band.
- **The measure.** Split the anchors at re-anchors > 60 s (the capture's own seam bound). Take a width-21
  running median. **Persistence = the median level 60–120 s after a candidate minus the level 30–90 s
  before it.**
- **FAIL:** |persistence| ≥ **1 s** with **no record** in the seam sidecar, the journal, or `CLOCKSYNC.csv`
  (`synced` / `resynced`). **The journal's record set is every clock-event line for the device:** `off host
  (tolerance`, `device clock JUMPED`, `re-sync busy` and `device clock unreadable`. A FAILED re-sync is
  still a record that a clock event happened. The first cut counted only `off host` and so FAILed a night
  the daemon had logged (08-18, below).
- **UNKNOWN `clock-sets too dense to attribute`:** when recorded clock-sets are so dense that the
  persistence windows straddle several of them — the 08-28 → 09-12 resync storm, one set every ~5.5 min,
  where ±15–30 s flips minutes apart cannot be assigned to one another.
- **Why persistence and never the windowed peak.** Over the corpus, **1,237 of 1,756** windowed-shift events
  above 1 s (**70 %**) were delivery-latency **TRANSIENTS**: late batches after a stall or pull pause raise
  the residual, and it **returns**. A 30 s windowed peak cannot tell them from a step — it fails the
  both-hypotheses test. **Do not re-tune this band to the windowed peak.**
- **Why all three records, and every phrase.** The journal carries 338 H10 `off host` warnings, 2 `device
  clock JUMPED` and 9 `re-sync busy`; `CLOCKSYNC.csv` carries 386 `synced` + 290 `resynced`. Matching the
  journal alone missed half the recorded clock-sets, and matching `off host` alone missed the `JUMPED` line
  that recorded 08-18.
- **The bar, with its n.** Over **n = 36 clean nights** (08-01 → 08-27 and 09-13 → 09-23; storm nights excluded
  as unadjudicable) the quiet windowed-shift p99.9 is **81 ms** (median per file), and the smallest real
  unrecorded step is **14.5 s**. So 1 s sits **~12× above the noise and ~15× below the signal**. The exact
  value barely matters, and it is not to be tuned.
- **What it found — restated after the record set was widened.** An unrecorded persistent step on **1 of 36**
  clean nights: **09-19 20:26, ≈ +14.5 s, on the H10's axis** (from `Polar_H10_02849638_20260919192038_ECG.txt`;
  one event seen in three overlapping windows). **None in the 1–2 s band**, so the "walk below the watchdog"
  class is absent from the clean corpus.
  - **08-18 04:08 was RECORDED, not unrecorded.** The journal logged `device clock JUMPED -41.0s (-0.1 ->
    -41.1) — re-syncing` at 04:09:08, then `re-sync busy (TimeoutError)` at 04:10:01 (Wren). The first
    matcher counted only `off host` and missed it. The **sign agrees**: a device falling 41 s behind raises
    host − device, so the shift is positive. **The magnitude does not:** the persistence measure read +28.6 s
    against the logged 41.0 s, and **that gap is unverified**.
  - **Not a host-side step — refuted.** The box re-arms `chronyc makestep 0.1 3` at runtime (`tepna-clock.sh
    sync`, 71 re-arms since 08-07). The last re-arm before each instant was **08-17 14:58:04** (13 h before
    08-18) and **09-17 21:37:41** (47 h before 09-19). A burst window closes within about an hour, so neither
    instant sits inside one and the host could not have stepped (Wren).
  - **09-19 is therefore a device-side event the watchdog did not log.** No clock line exists on the box.
    The H10 was off the link 20:28–20:33 (`auto-sync deferred — device not found` ×4). The shift looks like
    a **reconnect with a different device clock**, unrecorded. Routed to Heron.
- **What the fixed reading would have done, measured.** A per-anchor raw jump > 1000 ms has only **1.78×
  headroom** on a quiet night (09-23: max 562 ms) and is **blind** to 08-27's +1,508 ms pre-seam walk,
  which spreads over ~17 anchors at ~89 ms each. It fails both ways.

**Open — found by scoring 09-23, NOT decided here:**
- **BACKCHECK-VERDICT has no mapping into the night.** 09-23's is FAIL on 107 clipped regions (26 on the
  H10 ECG). Clipping is signal saturation — closest to validity, which by §3.4 does not fail a night — but
  §2 says the verdict *composes* the four existing verdicts, and §3.4 composes from criteria without saying
  what each verdict's status contributes.
- **QC-VERDICT's `coverage` has an unknown denominator.** On 09-23 it reads ≈ 0.89–0.92 on every stream,
  including streams that stopped at different times, which suggests a fixed night window rather than the
  worn interval. It is not usable as completeness until its denominator is known.
- **The settle trigger's wording.** §2 says "N+1's first data write"; that fired at **05:46:22** on 09-24,
  from a morning ring reconnect. Wren's acceptance measures from "the first ECG write". They name different
  events. 09-23's loss audit had not landed at 05:50.

## 4 · Assignments (issued 2026-09-23 ~19:30)

| bird | lane | first unit |
|---|---|---|
| **Heron** | the daemon and the devices | finish the capture-host absence rows (the instrument's honesty), then the top of §5, one defect per unit, the verdict as acceptance |
| **Wren** | the measurement, on the box | attribute the unattributed H10 losses (09-04 · 09-05 · 09-12) by the cadence-table method; ground truth for the bands; refute any band a real night contradicts |
| **Magpie** | the verdict and its monitor draw | `nightqc.py` composition of the four existing verdicts + bands + the monitor line; runs in the QC poller's child process (#2936) |
| **Osprey** | the ONE processing lane, narrowed | absence refusals only (`ABSENCE-SURVEY` rows), the "follow the value downstream" rule binding; no features |
| **Finch** | capture when engaged | BLE / firmware on demand |
| **Kestrel** | coordinator | §5's ranking; then whatever the ranking leaves undefended |

**Stops during the phase, fleet-wide:** new gates without a measured false negative; node feature
work; UI, storage, security; P1–P4. Deploys and daemon restarts stay owner-authorized.

## 5 · The ranking — nights lost by capture defect (Wren, from the box's LOSS-AUDIT files, 2026-09-23)

> ⚠️ **PROVISIONAL (marked 2026-09-24 00:20).** Every number in this section was read from the 28
> `LOSS-AUDIT.json` files as they stood on 2026-09-23, i.e. written by the PRE-#2977 attribution, which
> matched journal lines by device NAME and a fixed KIND list and therefore could not read the offline-op
> pause lines at all (8,369 of 8,956 carry only the device address). A daemon-caused minute that
> attribution could not see lands in `unattributed` or in a device class, so the ORDER below may be
> wrong; `daemon_caused_min = 0.0` in those files is the instrument not looking, not a measurement
> (Heron voided his own "the pauses cost nothing" claim on exactly this). Wren is re-auditing under
> #2977 — 08-27 first, then 09-19, 09-18, then the rest — with each old audit preserved beside the new
> one, and this section is re-ranked from the re-audited files before any Heron unit is chosen from it.
> Until then the ranking is a hypothesis about the order, not the order.
>
> 🟢 **RE-AUDITED (Wren, 2026-09-24 00:5x, all 28 nights under #2977, code 67c850ca; each previous audit
> kept beside the new one as `LOSS-AUDIT.prev-2026-09-23.json`; `lost_min` unchanged on every row, only
> the attribution moved).** Two classes became visible: **`daemon:pull paused live`** (the #2982 churn)
> **34.4 min over 28 nights, 72 % of it on 08-27** — Verity 0 → 24.9 of 33.3 lost (8.4 still
> unattributed), 08-28 Verity 0 → 6.9, two small H10 pieces on the battery nights; nothing on 09-18 or
> 09-19. So #2982 WAS capture work, with one exemplar night, and small elsewhere. **`daemon:clock
> re-sync`** (the #2459 storm) **154.6 min across 16 device-nights** — H10 09-05 40.6 · 09-04 38.0 ·
> 08-29 25.5 · 09-12 20.7 · 09-11 8.9 — the instrument now reads what Wren's scan had found by hand
> (147.3), plus the Verity-side resyncs. Unchanged: 09-03 H10 104.9, 09-12 Verity 127.1 (pre-wear,
> correct), 09-20/21 H10 battery 210/244.
>
> **Re-ranked work order:** every daemon-caused class in the corpus is now attributed to a mechanism
> already fixed (#2833 battery inference, #2459 resync storm, #2982/#2983 churn) or to correct
> behaviour. What remains unexplained is small: 08-27 Verity 8.4 min and the Verity's other
> unattributed minutes. The phase's next capture units therefore come from NEW nights scored by the
> verdict, not from this table — which is what the exit criterion is for.
>
> **08-27 is the box-failure exemplar, not no-wear (Heron, 2026-09-24):** ring 428.3 min recorded, 0.3
> lost — wear proven — while the Verity got 34.2 min in 17 fragments and lost 33.3 (49 %), every minute
> `unattributed`, 123 connects, 243 pauses on its address. The first place the re-audit looks.
>
> **The absent-night class, measured with the discriminator (Heron, 2026-09-24):** the daemon pins ONE
> global sensor adapter per DAEMON START (`BLE adapter pinned: <MAC> → hciN`; the second radio in the
> journal is the CPAP's). 09-01, 09-02, 09-14, 09-18 are NO-WEAR — each with a sibling connecting on
> the same pin in the same daemon-start segment AND device-positive evidence (`in_charger`, "wear it
> finger-in"); 09-14 is the strongest (all three sensors connected on hci0, none recorded a primary
> file). A no-wear night is **NOT_APPLICABLE**, never FAIL, and the consecutive counter SKIPS it; the
> witness is PER DEVICE (a silent device with no sibling on its pin in its segment and no self-evidence
> is UNKNOWN even when the night is not); the exit reads "14 solid of N nights over D days".

28 nights, 2026-08-25 → 09-21 (`vigil:~/wren-notes/loss-by-night-2026-09-23.tsv`, 112 device-nights).

| device | nights present | nights > 5 min lost | lost min | daemon-attributed | fragments |
|---|---|---|---|---|---|
| Polar H10 | 25 | 11 | 781.9 | 567.1 | 590 |
| Polar Verity | 26 | 10 | 247.3 | 141.0 | 210 |
| O2Ring | 26 | 0 | 10.4 | 0 | 69 |

By cause: H10 not-worn drop **561.7** (the flat-battery inference on the new CR2032, fixed #2833 —
09-22 witness: 0 drops, coverage 0.999) · H10 unattributed **214.8** · Verity not-worn drop 141.0 ·
Verity unattributed 106.3 · ring unattributed 9.7 · H10 stall re-negotiate 5.4 · ring link timeout 0.7.

Night-absent class (not gaps — the audit cannot count them): H10 missing 09-01, 09-02, 09-14 and
short on 08-27 (50 min), 09-18 (24), 09-19 (68); Verity missing 09-14, 09-18, short 08-27 (34); ring
missing 09-14, 09-18.

**Attribution of the "unattributed" H10 class (Wren, same evening, 28 nights):** 147.3 of the 214.8
min (69 %) are gaps preceded within 15 s by a journal line `device clock is −29.2 s off host —
re-syncing`: the daemon paused live capture for an offline op every ~5.5 min, the ECG gapped 55–100 s
each time, the resync never held, and the storm repeated (resync lines per night: 09-05 73 · 09-06
74 · 09-11 55 · 09-12 55 · zero on every night since #2459 merged on 09-13). Corrected: **H10
daemon-caused 714 of 782 min (91 %)**, both mechanisms already fixed (#2833, #2459); the H10's own
remaining loss is ~67 min in 28 nights (09-12 19.7 in 67 short gaps · 09-03 8.5 · 08-25 6.8). The
resync storm and the 09-22 stall are one shape a layer apart: the box tearing its own recording. An
instrument defect made it invisible — `loss_audit.py` matches journal lines by device NAME and a
fixed KIND list; the resync line matches no KIND, and 8,369 of 8,956 `live capture paused` lines
carry only the device ADDRESS — Wren's unit, go given 2026-09-23 ~19:50.

**Work order this yields, top-down (corrected):**
1. The `loss_audit.py` instrument: the resync KIND, and match on name OR address, with plants run
   with and without the fix; re-auditing re-labels the old nights (Wren).
2. **The night-absent class — Heron's first daemon unit**: why an expected device produced no file
   on six nights (H10 missing 09-01/09-02/09-14, 50/24/68 min on 08-27/09-18/09-19; Verity and ring
   missing 09-14/09-18). The journal per device per night: never started (daemon down, adapter down,
   not advertising, never worn) · started and torn · started under another name.
3. Verity unattributed 106 min — the same attribution method (Wren).

**The Verity 09-12 "drop" was the daemon being RIGHT (Wren):** all 62 drops fall 18:24→20:36, before
bed; the PPG between them carries no pulse (autocorrelation 0.1, AC amplitude at the noise floor),
the reconnected PPI set `received no rows` 61 times, and the H10 on the same body read 81–84 bpm;
from 20:37:51 the PPG is pulsatile and matches the H10 beat for beat, and the drops stop at that
minute. The audit booked the pre-wear span as `worn_lost_min` because `worn_evidence` is NIGHT-level.
Consequence for §2: **loss is counted only inside the WORN interval, taken from the device's own beat
evidence** (first → last pulsatile window), never from the file span; outside it a gap is `doff`.
With both corrections, every daemon-caused minute over 28 nights is already fixed (#2833, #2459) or
correct behaviour, which is why the work order starts with the nights that never started.
4. The 09-19 → 09-22 stall (fixed #2936, live since 06:52 on 09-23) — tonight is its acceptance.
5. The ring is effectively solid on every night; its in-band blanking is a validity-sidecar matter
   (#2317/#2950), already recorded per night.

## 6 · Owner decisions this brief waits on

- ~~Is the **COOSPO 808S** an expected stream?~~ 🟢 **ANSWERED — owner, 2026-09-23 ~20:00, verbatim:**
  *"Coospo is just backup that can produce rr and hr only. It's not expected to be used, but it's
  widely used device and still can provide some info. I would not expect to be used unless manually
  entered to capture."* So: `expected: false` by default; expected for a night ONLY when manually
  entered into that night's capture, and then its HR/RR are scored like the H10's RR. The verdict's
  expected-stream list is therefore PER NIGHT, from the capture's own device set, never a static
  config; the audit's `no primary stream known for model 'HRM808S'` is a non-finding on a normal
  night. No Heron unit.
- The **known-clock adversarial capture night** (`KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14`) is
  still the owner's to run; it is capture work and belongs in this phase.

## Done when

- [ ] §3 bands stated in the verdict PR before the first night is scored, and the verdict emits
      UNKNOWN (`not settled`) until night N+1's first data write.
- [ ] `solid-night` verdict written for every night from 2026-08-25 on, drawn on the monitor.
- [ ] §5's work order executed top-down, each unit accepted by the verdict, not by prose.
- [ ] **Fourteen consecutive SOLID nights.** Then this brief flips to DONE and the fleet refocuses on
      processing (`ABSENCE-SURVEY` remainder first, then `STRATEGIC-PRIORITIES` P4 → P3 → P1).
