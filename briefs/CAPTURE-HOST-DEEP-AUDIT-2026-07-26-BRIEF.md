<!--
  CAPTURE-HOST-DEEP-AUDIT-2026-07-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-26 · **Created:** 2026-07-26 · **Followed-by:** `CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md` · **Method-parent:** `AUDIT-PROMPT.md` · **Relates:** `VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF.md` (§A3 amends its §1.6 and §5.1), `VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md` (§D2/§D3 are its §2A items, partially executed), `CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md` (§A1 amends its §F2), `VIGIL-AUDIT-FIXES-FOLLOWUPS-2026-07-22-BRIEF.md` (§A2 amends its §1), `VIGIL-HARDENING-II-2026-07-25-BRIEF.md` (§C4 is the source-side half of its §1.3), `CPAP-AUTOHARVEST-2026-07-26-BRIEF.md` (§C5, §E3–§E5)

> **§A3 warm-up residual — ACCEPTED, not corrected (decided 2026-08-05, FOLLOWUPS §1.1).** The first
> `_O2PPG_EST_MIN_S` (30 s) of each O2Ring session is written at the configured rate, freezing a flat
> **+0.227 s** into that session's accumulated ns column — a one-off, not a rate (unchanged from a 1 min
> session to a 10 h one, i.e. ~6 ppm over a night), against a defect that accumulated +9.2 s per hour.
> The cheap fix — persisting the last-measured rate per device address — is **declined**: it introduces
> CROSS-SESSION STATE, which is the bug class §A1 exists to prevent, and a rate carried over from a
> different battery/temperature state would start a session mis-calibrated with nothing signalling it.
> A bounded, measured, non-accumulating offset that a test already pins is preferable to an unbounded
> class of silent error. Revisit only if a downstream consumer is shown to resolve better than 0.227 s.

# Capture-host deep audit — the writer's clock never expires, and four gates that grade a hole green

> **Scope:** out-of-suite (`capture-host/`, Python + `deploy/` shell). **No Dex bundle, no `manifestHash`,
> no fixture, no provenance impact** — `Dex-Test-Suite.html` and `verify-provenance.html` are untouched by
> everything below. The gate that applies is the capture-host pytest suite: **1391 green at baseline**
> (`capture-host/.venv/bin/python -m pytest tests/ -q`, 2026-07-26 20:5x).
>
> **Method:** invariant-and-counterexample per `AUDIT-PROMPT.md`, run as **7 parallel dimension hunters**
> (clock · units & hardware honesty · fabricated absence & silent failure · filenames/night-boundaries/CPAP
> harvest · host-state & shell surface · webmon · missing-instance matrix & sibling divergence), each
> followed by an **independent adversarial verifier** whose instruction was to *kill* its hunter's findings
> and default to REFUTED without a reproduction it ran itself.
>
> **30 candidates → 27 CONFIRMED, 3 REFUTED, 0 unverified.** Every CONFIRMED entry below was reproduced
> twice, by two agents, on this machine. Seven of the 27 ship with a **verifier correction** that changed
> the mechanism, the severity, or the blast radius — those corrections are recorded inline, because in each
> case the hunter's *narrative* was wrong while the *defect* was real, and shipping the narrative would have
> got the fix wrong.

---

## 0. The one-paragraph story

The three worst findings are all the same shape: **a piece of state that models "the session" but is scoped
to something else.** `capture.py`'s absorbed DST/timezone offset is scoped to the **process**, and
`tepna-capture.service` is `Restart=always` with no `RuntimeMaxSec` — so one autumn clock change stamps every
subsequent night an hour off civil time, indefinitely, and a deliberate `timedatectl set-timezone` from the
monitor is swallowed by the identical code path while `/api/clock/tz` answers ok. `nightqc`'s coverage is
scoped to the **last merged session**, so a box-wide outage longer than an hour makes it discard the whole
pre-outage half of a night and grade the remainder `coverage: 1.0, ok: true`. `timeline`'s coverage
denominator is scoped to the **LINK sidecar's calendar day**, so a flawless zero-loss 4 h night renders as
**16.7 % captured** — and a second, independent denominator defect in the same expression reaches **196.7 %**
on real corpus. In every case the number that reaches the operator is plausible, the gate that should have
caught it is green, and the failure is invisible precisely because the code's own comment states the correct
rule that the code does not implement. Alongside these: the alerting path can be silenced for a whole
episode by one failed webhook POST, with no journal line either way; the archiver's `.archived` marker is a
one-way latch on a night that can still grow; and the watchdog still treats `connected` as `streaming` — the
exact confusion commit `1f6bcdf` fixed in the CPAP interlock *the same day*, one module over.

---

## A · Wrong number — a recorded or surfaced measurement is silently incorrect

### A1. The absorbed DST/timezone shift is process-global, so every later night is stamped an hour off — `capture.py:128`

`_civil_shift` / `_anchor_wall` / `_anchor_utcoff` (`capture.py:89-92`) are module globals with **no
lifetime**. The DST branch at `:125-129` absorbs a civil relabelling into `_civil_shift`, and `_reanchor(shift)`
(`:107`) deliberately carries it forward on every later re-anchor. `CAPTURE-HOST-FOLLOWUPS-II §F2` (the fix
that introduced it) and the code comment both scope the behaviour to *"the session's original offset frame"* —
but the **state is scoped to the process**, and the unit is `Restart=always`, `RestartSec=5`, `WatchdogSec=120`,
**no `RuntimeMaxSec`**, no `.timer`. It is meant to run for months.

```
DST transition -3600s — civil clock relabelled, NOT stepped
+  1d : capture stamp 2026-11-02T02:00:00.000 | true civil 2026-11-02T01:00:00.000 | err +3600s
         file Polar_H10_02849638_20261102020000_ECG.txt | night_dir captures/2026-11-02
+  7d : ... err +3600s | file Polar_H10_02849638_20261108020000_ECG.txt
+ 30d : ... err +3600s
+120d : capture stamp 2027-03-01T02:00:00.000 | true civil 2027-03-01T01:00:00.000 | err +3600s
```

**Second trigger, worse because it is deliberate:** a zone move looks *identical* to a DST relabelling (offset
delta == apparent drift), so `/api/clock/tz` → `clockcfg.set_tz` → `timedatectl set-timezone` reports ok,
`clockcfg.status()` reports the **new** timezone with `contract.tz_set: true`, and the stamps silently stay in
the old zone: `TZ=America/Chicago stamp 22:01:01 | civil 21:01:01 | err +3600 s`, still +3600 s at +10 d.

**Blast radius (verifier-traced, not assumed):** `_now()` drives the per-sample Phone-timestamp column, the
**filename** stamp, `night_dir()`, the LINK/CLOCK sidecar names and `STATUS["updated"]`. The Polar
`sensor timestamp [ns]` column comes from raw `_utcnow()` and is **unaffected** — so within one file the two
time columns disagree by an hour, and any co-analysed CPAP EDF or Lingo CGM export (real zoned stamps) breaks
alignment by exactly one hour. Downstream this is a **floating `tMs` that is one hour wrong in absolute terms**.

**Why the gate is green:** `tests/test_capture_clock.py::_install` monkeypatches `_utcoffset` out and never
advances past the transition night, so all 11 clock tests pass with the defect live.

**Fix.** Give the absorbed shift a lifetime bounded by the artefact it protects: expose
`reset_clock_anchor()` and call it whenever **no writer is open** (a discontinuity between sessions is free —
a new file starts anyway), or split `_now()` (in-file stamps, absorbed frame) from a `_civil_now()` used by
`night_dir`/`capture_filename`/status and let the absorbed frame expire at the night roll. Either way add an
explicit *zone changed deliberately* path so `set_tz` re-anchors instead of being absorbed. New tests must
drive a **fold-correct** epoch clock across multiple days and across a zone change. **Gate cost:** capture-host
pytest only.

### A2. A >1 h box-wide outage makes `nightqc` discard the pre-outage half and grade the rest green — `nightqc.py:204`

`summarize()` merges each device's `[start_stamp, mtime]` intervals with `_SESSION_GAP_SEC = 3600`, then takes
`cur = max(sessions, key=lambda s: s[1])` — **the single session reaching the newest write**. Everything older
is dropped from `current`, so `streams[]`, `coverage[]`, `span_sec`, `missing` and `silent_sec` all describe
only the last segment.

```
"devices": [{"name":"H10","streams":{"ecg":1638000},"coverage":{"ecg":1.0},"silent_sec":0},
            {"name":"Verity","streams":{"ppg":693000},"coverage":{"ppg":1.0},"silent_sec":0}],
"missing": [], "degraded": [], "span_sec": 12600, "total_rows": 4329000, "ok": true

ECG rows actually on disk : 3042000
ECG rows nightqc reports  : 1638000
night really ran 22:00->09:00 (11 h wall, 6.5 h of data); span_sec reported: 12600
```

The scoping was added deliberately (`VIGIL-AUDIT-FIXES-FOLLOWUPS-2026-07-22 §1`) to stop a *daytime sitting*
diluting tonight's coverage — but the file-activity signature of "an earlier unrelated session" and "this same
night, interrupted for >1 h" is **identical**, and nothing distinguishes them. `tests/test_nightqc.py:147`
covers only the intended daytime case.

> **Verifier correction.** The hunter's "self-contradiction inside one document (`total_rows` 4329000 vs
> per-device 2331000)" is **not** evidence of an unexamined consequence — `summarize`'s docstring says
> `files`/`total_*` describe the night *folder*, so that divergence is documented and deliberate. The defect is
> narrower and cleaner: `span_sec`, `coverage`, `missing`, `silent_sec` and `ok` are **silently** session-scoped
> with no field saying so. Reachability should cite the measured **2026-07-24 03:33→04:32 box-wide silence
> (58.6 min)** — 85 s under the threshold, i.e. this has already come within a minute and a half of firing on
> the real box.

**Fix.** Keep the scoping, stop it being silent: return the discarded sessions (`sessions: [{start,end,rows}]`
plus `prior_gap_sec`) and make `ok` false — or add a `gaps:` list beside `missing`/`degraded` — when
`prior_gap_sec` is non-null on the same calendar night. **Gate cost:** capture-host pytest only.

### A3. The O2Ring PPG grid declares a rate the ring does not run, and the correction is structurally one-sided — `capture.py:226`

`O2PPG_FS_DEFAULT = 125.738` is a constant calibrated 2026-07-18, and `O2PPG_NS_STEP = int(1e9/O2PPG_FS)` is the
**only sample clock the O2Ring file carries** (the ring publishes no PER-SAMPLE clock — corrected 2026-09-06:
it does carry a 1 Hz session counter, `duration_s`, which is a rate reference far too coarse to place samples;
residue `2026-09-06-ring-duration-counter-bimodal`). The session-anchored correction at
`:1576` only ever *advances*: `if target - ppg_idx[0] > O2PPG_GAP_MIN_S*O2PPG_FS`. That reasoning holds only
when the ring runs **slower** than the constant. When it runs **faster**, the difference is monotonically
negative, the branch can never fire, and the grid runs ahead of real time without bound.

```
2026-07-22  7 files  125.7218 Hz  -0.013%
2026-07-25  5 files  125.7479 Hz  +0.008%
2026-07-26 10 files  125.9530 Hz  +0.171%   <-- all 10 above the entire prior range

125.726 SLOWER than configured (the only case tested): inflation +0.0274%  gaps=7  fabricated +1.0 s/h
126.02  FASTER than configured (measured 2026-07-26): inflation +0.2519%  gaps=0  fabricated +9.1 s/h
```

> **Verifier correction — this sharpens the finding rather than weakening it.** "The ring no longer runs at
> that rate / it moved 0.17 % in a day" is **not** established, and the parsimonious mechanism is worse for the
> code: `rows/wall` is bounded **above** by the true ADC rate (link loss can only lower it), so each day's
> **maximum** `rows/wall` is a lower bound on the ring's true rate — and it exceeds 125.738 on **every day of
> the corpus** (07-18 125.826 … 07-26 126.045). The constant was mis-calibrated low from the start; 2026-07-26
> is merely the cleanest-link day, which is why it shows the truth most plainly. Independent check: the Polar
> dies give `dev_ns/host = 1.000020`, so the host clock is not the variable.

`VIGIL-PPG-GRID-AUDIT §1.6` blessed the asymmetry as "the safe direction" having measured only the slow case,
and `tests/test_o2ring_ppg_gap.py:170` pins exactly that one direction.

**Fix.** Re-estimate the effective step from the session anchor (`step = (arr - ppg_t0)/idx`, slew-limited)
instead of hard-coding `O2PPG_NS_STEP`, so a fast ring *shortens the step* rather than banking error and the
ns column stays strictly increasing by construction. Add the missing sibling test
`test_fast_clock_drift_corrects_toward_the_host_clock` (`true_fs = 126.02`) — it fails against current code at
+0.2519 %. Do **not** merely re-calibrate the constant; that repeats the 2026-07-18 fix with a new number.

#### A3-rider. `ppg_grid_check` names a mechanism it never measured — `ppg_grid_check.py:58`

A file with **exactly zero inserted gaps** (one distinct `sensor_ns` delta across 331 551 steps) is reported
`<-- TIMELINE INFLATED, +0.244 %, 6.4 s fabricated` under a banner asserting *"These files' BEAT TIMELINES are
stretched at each phantom gap … They cannot be repaired."*

```
rows 331552  distinct sensor_ns deltas: 1 [(7953045, 331551)]
{'inflation': 0.0024362, 'fabricated_s': 6.408, 'rows_per_wall': 126.0447}
verdict: inflated
corpus: 1340 files — 85 INFLATED, 17 lossy, 140 ok, 1098 too short to judge
```

Two mechanisms produce the same ratio — gap insertion (discrete stretching) and a mis-calibrated constant `fs`
(**uniform** stretching) — and the tool assumes the first exclusively. The file records the distinction for
free (a gap is a non-modal `sensor_ns` delta; the uniform case leaves the delta set a **singleton**) and the
tool never reads it.

> **Verifier correction.** Severity label `silent-failure` does **not** fit: the tool is loud and its
> *numbers* are correct. What is false is the **attribution** (a mechanism absent from the data) and the
> **remediation** ("cannot be repaired" is wrong for a uniform grid — a single scale factor recovers the span
> exactly, because the endpoints are anchored to the phone clock). File it as a **rider on A3, not standalone**:
> with A3 live, 8 freshly-written 2026-07-26 nights breach this tool's own 0.2 % threshold, so the shipped gate
> now mislabels good data as unrepairable.

**Fix.** Return `gaps` (count of deltas ≠ modal step) and `gap_seconds` from `grid_inflation()`; give
`_verdict()` a fourth state — *rate-mismatch (uniform, exactly rescalable)* — and make the banner print the
mechanism it measured instead of the one it assumed.

### A4. `timeline.build`'s coverage percentage has two independent denominator defects — `timeline.py:408`

Both were filed separately, by two hunters, on the same line. Both reproduce.

**(a) The denominator is the LINK sidecar's calendar day.** `spans` is seeded with each LINK sample list's
first/last timestamp; `VIGIL-AUDIT-FIXES §1` made the sidecars roll **per calendar day**, so a continuously
running box always has one spanning 00:00→23:59, and the cross-midnight pool adds the previous day's too.

```
recording: 2026-07-10 02:00 -> 06:00  (4 h, 1 872 000 rows @130 Hz, ZERO loss)
timeline window : 00:00:05 -> 23:59:25  (23.99 h)
covered_sec     : 14400 (= the full recording)
coverage_pct    : 16.7 %          <-- a flawless night
nightqc span_sec: 14400 s         <-- the honest span, computed correctly one module over
```

Line 408's own comment promises the opposite: *"Against the SESSION span, not the wall-clock night."*

> **Verifier correction — causation.** `git log -L 375,390:capture-host/timeline.py` returns exactly one
> commit, the module's creation, with the sidecar-seeding lines already present. The defect is **original to
> `timeline.py`**; the per-day roll *mitigated* it (before it the sidecar was one unbounded file, so the
> denominator was multi-day). Do not blame `VIGIL-AUDIT-FIXES §1` in the fix commit.

**(b) `t1` excludes the last session's own duration**, because `spans` collects file **start** stamps only,
never `start + rows/fs` — so `coverage_pct` exceeds 100 %:

```
9 h night, 50 min outage : coverage_pct 156.5   covered=21600  window=13800
1 h then 6 h session     : coverage_pct 466.7   covered=25200  window= 5400
```

> **Verifier correction.** The hunter's real-corpus conclusion "OVER-100 %: none on any night" is **refuted** —
> run against the *shipped* `config.yaml` device list, real nights give **196.7 %** (Polar H10 acc, 2026-07-16)
> and **134.6 %** (Verity acc, 2026-07-20). Those come from a **third** mechanism the filing missed:
> `covered_seconds` builds each interval as `[start, start + rows/fs]` with `fs = nightqc._expected_hz` = the
> **currently configured** rate, and the configured rate has changed since those nights were recorded. Fix all
> three or the badge stays wrong.

**Fix.** Derive the denominator from the recording, not the sidecar — factor `nightqc.summarize`'s
merged-interval session span into a helper both modules call; append each interval's **end** to `spans`; and
take `fs` from the file's own header/era rather than today's config. Clamping to `min(100, …)` alone would
hide the truncated strip, which is the same defect rendered.

---

## B · Fabricated absence — a guess in a measurement's clothes

### B1. A failed RSSI read re-logs the previous reading as a fresh measurement — `capture.py:2289`

`rssi_poller` calls `_set(rssi=…)` only when the read **succeeds**, then unconditionally writes
`st.get("rssi")` into the LINK row. Every unreadable poll therefore re-records the last good dBm at a new
timestamp, indistinguishable from a real one. After three consecutive failures the poller goes `idle` and
suppresses reads for `rssi_retry_sec` (600 s) — 24 further rows at 25 s, all carrying the same stale value.

```
Phone timestamp;device;connected;rssi_dbm;...
2026-07-26T21:02:50.422;H10;1;-55;...
2026-07-26T21:02:50.422;H10;1;-55;...
2026-07-26T21:02:50.422;H10;1;-55;...
2026-07-26T21:02:50.422;H10;1;-55;...
(1 real measurement -> 4 recorded readings)
```

The parse side is already scrupulous — `VIGIL-PPG-GRID-AUDIT §4` tightened `parse_rssi` to −127…−1 so BlueZ's
sentinels return `None`, *"Recording 'unknown' is the honest answer"* — and that fix strictly **increased** how
often the stale value gets logged instead of a blank. `timeline.bucket_link` then medians the column and the
monitor renders it as the night's signal trace.

> **Verifier correction.** The real-corpus corroboration leg is **unsound and must not ship**: the 2026-07-25
> 02:07→02:14 frozen run is not the global-`idle` signature (the H10 varies row-by-row through the same window),
> and that file contains 5 positive dBm values, which post-§4 `parse_rssi` cannot emit — it was written by
> **pre-fix** code. The synthetic repro stands on its own; drop the corpus claim.

**Fix.** Make the read authoritative: `rssi = await link_rssi.read_rssi(...)` then `_set(name, rssi=rssi)`
unconditionally (`None` included), so an unreadable poll writes the blank `LinkLogWriter._f` already intends;
while `idle`, write `None` — an un-polled row is not a measurement.

### B2. The legacy Viatom runner still writes a fabricated pulse of `0` — `capture.py:1364`

`VIGIL-PPG-GRID-AUDIT §5.2` removed `or 0` from the **OxyII** call site and left both a comment there and a
past-tense docstring on `writers.Spo2CsvWriter.write` — and never touched the **second producer of the identical
CSV**, one screen up.

```
decode_packet -> {'spo2': 96, 'pr': None, ...}
row written by the LEGACY viatom runner : '02:03:04 26/07/2026,96,0,3'
row written by the OXYII runner (fixed)  : '02:03:04 26/07/2026,96,,3'
```

Reachable by configuration (`protocol: legacy`, documented at `config.example.yaml:83`), not dead. The
regression tests exercise the **writer**, not either caller, so they stay green while one caller pre-fabricates.

> **Verifier correction.** Impact is smaller than filed and must be stated: the producing brief measured that
> `0` and blank are **rejected identically** by the shipped `oxydex-dsp.js` (`parseInt('') → NaN` and `0 < 20`
> hit the same `continue`), with 0 occurrences across 110 k real rows on the sibling path. **No downstream
> number moves.** What ships is a raw vendor CSV asserting a pulse the ring never measured, on a config path no
> current device uses — a latent file-honesty / sibling-divergence defect.

**Fix.** One line: `wr.write(now, pkt["spo2"], pkt["pr"], pkt["motion"])`, matching `:1607` verbatim. Add a
**caller-level** test; writer-level tests structurally cannot catch a caller that fabricates before it writes.

---

## C · Silent failure — degrades quietly instead of reddening

### C1. One failed webhook silences a sensor-offline alert for the whole episode — `capture.py:2427`

`alert_poller` does `alerted.add(name)` **before** `await notifier.send(...)`, discards the returned bool, and
`alerts.Notifier.send` swallows every exception with **no log at any level**.

```
poll iterations = 40   webhook POST attempts = 1
Notifier.send() return value on failure: False
(40 minutes of a sensor offline; ONE attempt, which raised; zero journal lines at DEBUG or above)
```

The correct sibling is one function down: `qc_poller`'s frozen-device path (`:2494-2503`) deliberately
`log.warning`s **first** — *"WARNING even with no webhook configured. The journal is the only alerting surface a
box without one has."*

> **Verifier correction.** Two overstatements removed: (1) *"the event leaves no trace anywhere"* is false —
> `capture.py:1186/1409/1695` log a warning on every failed connect; what is untraced is the **delivery
> failure**. (2) The latch is not permanent for the process (`alerted.discard(name)` clears on reconnect), so the
> honest statement is **one missed alert per offline episode** — which, for the dead-battery case the alert
> exists for, is the whole night.

**Fix.** Log the condition before attempting delivery; latch on the send **result**
(`if await notifier.send(...) or not notifier.enabled: alerted.add(name)`); and `log.warning` inside
`Notifier.send`'s except and on a non-2xx — swallowing the exception must not also swallow the evidence.

### C2. The low-disk edge never reaches the journal — `capture.py:2384`

`storage_poller` sets `low_alerted = True` and sends **only** `if notifier`. There is no log call for the
low-free-space condition anywhere in `capture.py`.

```
STATUS['storage']['low'] = True  free_gb = 29.54
journal lines emitted over 5 polls of a LOW-DISK box with no webhook: ['Using selector: EpollSelector']
```

`diskguard.py`'s own header states the intent — *"a full filesystem turned every subsequent night into a silent
loss … So the emergency signal is loud"* — but it is loud only where a webhook exists.

> **Verifier correction.** One sub-claim is **false and must be removed**: the retention-held reason *is*
> logged (`capture.py:2364-2369`, once per episode, independent of the notifier). Only the low-free-space edge
> lacks a journal line. Also soften *"the sole surface is status.json"* — `/api/storage` and monitor.html's
> Storage view show it **on pull**; the gap is that it never **pushes**.

**Fix.** Move the log out of the notifier branch, plus a matching `log.info` on the recovery edge.

### C3. The watchdog still treats `connected` as `streaming` — `capture.py:280`

`any_connected = any(d.get("connected") …)` gates **both** the *pinned adapter DOWN* signal and the *InProgress*
signal. A sensor on its charger reports `connected=True` while producing nothing (the Verity literally sets
`last_error="charging — PMD streams unavailable"`), so **one docked sensor makes a genuinely DOWN adapter
classify as healthy**.

```
adapter probed DOWN, one CHARGING (connected, zero data) device present:
   {'wedged': False, 'reasons': [], 'phantom': []}
same, but the charging device's link had already been noticed as dropped:
   {'wedged': True, 'reasons': ['pinned adapter DOWN/not-found', 'H10: InProgress'], 'phantom': []}
```

`adapter_watchdog`'s own docstring (`:1981`) says the reset requires *"a single connected+**streaming** device"*.
The correct sibling exists and was fixed **the same day**: `cpap_harvest.blocking_devices` (`:148-170`) computes
*actually streaming* as `connected AND not charging AND worn is not False` — commit `1f6bcdf`, the CPAP
interlock. The watchdog does not even **pass** `charging`/`worn`/`last_sample` into the classifier
(`:2006-2008` builds only `{name,address,connected,last_error,bluez_connected}`), so it cannot make the
distinction.

> **Verifier correction — this inverts part of the fix.** It is **not** that `connected` is held stale through
> the `charging_hold` retry loop: during `charging_retry_in_place` the task stays inside `async with _connect(...)`
> and the BLE link is genuinely up, so `any_connected` is **honest** there. The real mechanism is that no runner
> carries a *streaming* signal into the classifier at all. Reproduced end-to-end in the runner, not just the pure
> function; it is **suppression-only** — it can never cause a spurious power-cycle.

**Fix.** Add `charging`/`worn` to the dict at `:2006-2008` and port `blocking_devices`' predicate verbatim.
Keep `any_connected` for the phantom-link branch — that one genuinely wants link existence.

### C4. `.archived` is a one-way latch on a night that can still grow — `nightarchive.py:32`

`pending_nights` skips any night carrying `.archived`; `archive_night` drops the marker unconditionally after
one pass; nothing ever removes it (`grep -rn '\.archived' --include=*.py` → no unlink). `unarchived_nights`
then reports the mirror confirmed — it checks only that `dest/<night>/` **exists**, not its contents — so
`prune_old_nights` deletes the local, and only complete, copy.

```
7 of 11 real nights have a genuine premature-archive window:
2026-07-17: quiet 05:06 -> 20:26 (15.33h)  data written afterwards: 293.4 MB
2026-07-20: quiet 10:14 -> 15:19 ( 5.08h)  data written afterwards: 828.8 MB
2026-07-22: quiet 10:56 -> 19:16 ( 8.33h)  data written afterwards: 652.5 MB
```

The trigger is structural: `writers.night_dir` keys a folder on the session's **start** date, so an
early-morning session and that evening's session share one `YYYY-MM-DD` dir with a multi-hour daytime lull
between them. `VIGIL-HARDENING-II §1.3` hardened the **destination** side of exactly this reasoning — *"the
marker records that a copy was MADE, not that it still EXISTS"* — and never applied the identical argument to
the **source** side (*not that the source has not grown since*).

> **Verifier correction.** The headline "real box artifact" (2026-07-20's marker at 00:05:49 with 559 MB
> written after) is **residue of an already-fixed bug** — that marker lands 5 min past midnight, the exact
> wall-clock-date bug fixed in `VIGIL-AUDIT-FIXES-2026-07-21 §1`, landed the day *after* it was written. Cite
> the quiet-window measurements above for live reachability, not that marker.

**Fix.** Re-offer a night whose source changed since the marker (`mtime(file) > mtime(marker)`, fail-safe on
`OSError`); `archive_night` is already idempotent and size-diffed, so a re-offer costs only the new files.
Correspondingly, `unarchived_nights` should confirm **count/size parity** before releasing a night to
`prune_old_nights`.

### C5. A CPAP EDF truncated 0–2 % is accepted, reported ok, and skipped forever — `cpap_harvest.py:102`

Two tolerances that were never reconciled: `should_fetch` skips when `abs(have-want) <= max(1.0, want*0.02)`;
`short_read` flags only when `abs(got-want) > max(2.0, want*0.05)`. Because 5 % > 2 %, **every truncation the
detector can see is one the resume logic would re-fetch — and the whole 0–2 % band is invisible to both.**

```
truncated 1.0% ( 22.3 KB missing): short_read=False  should_fetch(next run)=False
truncated 1.9% ( 42.4 KB missing): short_read=False  should_fetch(next run)=False
truncated 2.1% ( 46.8 KB missing): short_read=False  should_fetch(next run)=True

run 1 : {'files': 1, 'skipped': 0, 'short': [], 'errors': []}
        on disk 2259671 bytes; listing promised 2282496 -> MISSING 22825
run 2 : {'files': 0, 'skipped': 1, 'short': []}   <-- truncated EDF SKIPPED, never re-fetched
```

The 2 % was justified as *"the listing reports rounded KB"* — but that rounding error is at most 0.5 KB
**regardless of file size**, so scaling it with the file is what opens the hole (44.6 KB on a 2229 KB BRP.edf).
`EzShare.fetch` also `os.replace`s the body to its final name **before** `short_read` is consulted. Correct
sibling: `pull_session.py:145` gates its skip on **exact** equality.

> **Verifier correction — material.** The silent path exists **only** when the card frames the body by
> connection-close. With a declared `Content-Length`, urllib raises `IncompleteRead`, `_get` retries, and the
> failure lands in `st['errors']` with the file absent. Scope the finding to the no-`Content-Length` case.

**Fix.** Flat ~1 KB rounding allowance instead of a percentage; make `short_read` at least as strict as the
skip test; and do not `os.replace` a body that fails `short_read` — leave the `.part` and raise.

### C6. `mount_unit()` trusts a caller the sibling one function up learned not to trust — `storage_targets.py:330`

Commit `f27a586` ("dest_status defends its own filesystem access, not the caller's") added `_under_allowed_root`
re-checking to `dest_status()` with the explicit reasoning *"nothing stops a future caller handing it one that
never went through validation."* `mount_unit()`, three functions below, is exactly such a caller-trusting
consumer — and a **more dangerous** one, because its output is a command the operator pastes **as root** and its
unit body interpolates `Where={mp}` raw.

```
[config-authored target missing 'mountpoint'] HTTP 500
   storage_targets.py:330  mp = target["mountpoint"]  -> KeyError
[mountpoint outside MOUNT_ROOTS] HTTP 200
   {"mountpoint": "/etc/systemd/system"}  -> emits a paste-as-root .mount unit for /etc/systemd/system
dest_status on the same dict: {'ready': False, reason: "not under an allowed mount root"}
```

> **Verifier correction.** The hunter picked the **weakest** trigger (a hand-edited config, for a key
> `config.example.yaml` does not document) and missed the reachable one: `validate()` gained its charset check
> only in `46a43f7` (2026-07-26 09:21), and the immediately preceding version **accepts** such a mountpoint —
> so any target persisted before that commit is already in config.yaml and flows straight through. This is an
> **upgrade** path, not a hand-edit path.

**Fix.** Give `mount_unit()` the same self-defence: `_abs_path` + `_under_allowed_root`, and `_share_name`/
`_HOST_RE`-check `host`/`share` before they reach the unit body and the `iscsiadm`/`nvme` steps.

### C7. `sync-apps.sh` serves 34 pages with none of their JS or CSS — `deploy/sync-apps.sh:40`

`bundles=("$SRC"/*.html)` selects on **extension**, not on *is a self-contained bundle*. `$SRC` is the repo
root, where `*.html` matches 65 files: 10 owned bundles, **11 `*.src.html` unbundled editing sources**, 6
reference guides, the gate pages and ~30 analysis harnesses. No `.js`, `.css`, `adapters/`, `licensing/` or
`assets/` is ever copied, and `--check` compares `*.html` only — so it reports **green on this exact state**.

```
copied: 65 files
CPAPDex.src.html      19/19 refs MISSING   e.g. ['ans-design.css','cpapdex-app.js','cpapdex-coimport.js']
Data Unifier.src.html 27/27 refs MISSING   e.g. ['adapters/coospo-rr.js','adapters/libre-cgm.js']
OxyDex.src.html       24/24 refs MISSING   e.g. ['ans-design.css','clock.js','crossnight-envelope.js']
Dex-Test-Suite.html   57/57 refs MISSING
```

> **Verifier correction.** `index.html` **is** in the copied set, so Caddy serves it at `/` and there is no
> directory listing at the root; no served page links to a `.src.html`. The twins are reachable only by a typed
> URL — the "phone-tappable lookalike" framing is overstated. The served-page breakage itself is confirmed.

**Fix.** Copy the owned bundle set (from `tools/build.mjs`'s list or `BUILD-MANIFEST.json` + the 2
orchestrators), plus an explicit whitelist of `index.html` and the reference guides **together with their
assets**. Minimum viable: exclude `*.src.html` and every page with unresolved sibling refs.

### C8. The header-only pruner deletes one file of a two-file writer — `capture.py:1216`

`StreamWriter(stream='hr')` silently owns a second handle (`_RR.<ext>`) but exposes only `self.path`; the
teardown does `path = wr.path; wr.close(); os.remove(path)`.

```
opened: ['..._20260725001214_HR.txt', '..._20260725001214_RR.txt']
after the header-only prune: ['..._20260725001214_RR.txt']   (33 bytes: 'Phone timestamp;RR-interval [ms]')
real corpus, 2026-07-25: 4 orphan RR files with no HR sibling
```

The existing gate is mutation-blind: it exercises the **ppg** stream, which has no sibling.

> **Verifier correction.** One broken teardown, not three: only `run_polar` can own an `hr` StreamWriter, so
> the `run_viatom`/`run_oxyii`/START-rejected sites can never hold an `_RR` sibling. Blast radius is the ingest
> directory, not a computed number.

**Fix.** Give `StreamWriter` a `paths` property or a `discard()` that unlinks everything it owns; extend the
existing test to the `hr` stream so it fails first.

---

## D · The webmon control surface

### D1. `POST /api/storage` with an unparseable body silently deletes the offload target — `webmon.py:578`

```
BEFORE archive block: {"enabled": true, "target": {"kind":"mount","mountpoint":".../mirror"}, ...}
POST /api/storage (empty body) -> 200 ok=True
AFTER  archive block: {"enabled": false, ...}          <-- target GONE
ON DISK: {"enabled": false, ...}                        <-- persisted
```

`_body()` returns `{}` for any undecodable body; `tgt = validate(body["target"]) if body.get("target") else None`
then yields `None` and the `else: a.pop("target", None)` branch destroys the configured target. The handler's
own docstring claims *"a rejected target leaves the previous one running rather than half-applying"* — an
unparseable body is never *rejected*, it is **applied as a clear**. Second-order: at the next daemon start this
also un-gates retention's second-copy protection.

> **Verifier correction.** *"or any body lacking `target`"* is **not** a defect — that is the designed disable
> path, used by four tests and by monitor.html's full-state PUT semantics. The real defect is the
> **unparseable** body being treated as a deliberate clear.

**Fix.** Separate the three cases: body did not parse → **400** (make `_body` return a sentinel, not `{}`);
`"target" not in body` → leave it untouched; `body["target"] is None` → the deliberate clear.

### D2. `/api/settings` answers `ok:true` when the config write failed — `webmon.py:544`

```
/api/settings -> HTTP 200  {"ok": true, "changed": ["watchdog.interval_sec"], ...}
/api/remember -> HTTP 500  {"ok": false, "error": "config write failed (disk?)"}
/api/forget   -> HTTP 500  {"ok": false, "error": "config write failed (disk?)"}

config write failed: PermissionError(13, 'Permission denied')
in-memory cfg watchdog.interval_sec = 90.0   ON-DISK = 60
```

`VIGIL-DEEP-ANALYSIS-2026-07-22 §2A` named all three callers; commit `6a3f981` converted `remember` and
`forget`, `12e6a44` did `storage_post`, and `settings_post` was left. The gap is **locked in by a passing
test**: `tests/test_webmon_endpoints.py:279 test_settings_save_failure_is_swallowed` asserts
`== 200  # save failed silently, request still succeeded`.

> **Verifier correction — prior art.** This is **not a new finding**: it is a partially-executed item of an
> open brief (`VIGIL-DEEP-ANALYSIS`, still `Status: PROPOSED`). Record it there rather than as a discovery.

**Fix.** Return 500 like its three siblings, and **deliberately invert** that test (rename to
`..._is_reported`) — the assertion change *is* the fix, so call it out in the commit message.

### D3. `_body()` still 500s on valid-JSON non-objects — `webmon.py:55`

```
cpap/pull body=b'null' -> 500      body=b'[]' -> 500      body=b'"x"' -> 500      body=b'3' -> 500
/api/settings garbage -> 500 | empty -> 500
```

`_body` guards only a **decode** error. One line fixes it (`return d if isinstance(d, dict) else {}`), plus the
five un-migrated `await req.json()` call sites (`settings_post`, `clock_set`, `clock_tz`, `timesync`,
`polar_pull`). Also filed as `VIGIL-DEEP-ANALYSIS §2A [LOW]` — the un-migrated half is open, not new. **Fix
together with D1**, or the new 400 will mask the wipe.

### D4. The firmware-capability guard is absent for a device never seen this boot — `webmon.py:506`

```
device CONNECTED             {"rates": {"...": {"acc": 7}}}  -> 400
device OFFLINE (never seen)  {"rates": {"...": {"acc": 7}}}  -> 200  rates={'acc': 7}
device OFFLINE (never seen)  {"rates": {"...": {"acc": -1}}} -> 200  rates={'acc': -1}
device OFFLINE (never seen)  {"streams": {"...": ["bogus", "../../etc/passwd"]}} -> 200
```

> **Verifier correction — the trigger is narrower than the title.** The guard does **not** vanish "whenever
> the device is disconnected": `pmd_supported`/`pmd_options` are written once at connect and `_set` only ever
> `update`s, so they survive a disconnect. The real trigger is a device **never connected since boot**. Retitle
> accordingly. Consequence is bounded — `capture.py:827` ignores an unrecognised stream name (no writer, no
> file, no traversal) and `polar_pmd.py:166` honours a preferred rate only `if prefer in rates`.

**Fix.** Validate against a **remembered** capability set persisted at each successful connect, with a static
allowlist floor so an unknown stream *name* is 400 regardless of connection state.

### D5. Every config write destroys the operator's comments — `webmon.py:362`

```
comment lines before: 20   after: 0   values identical: True   mode 0664 -> 0600
lost, e.g.:  keep_nights: 14   # keep the newest 14 strict-YYYY-MM-DD night dirs; tonight is always protected.
```

`yaml.safe_dump` has no comment round-trip, so the emitted document is comment-free by construction. **This is
why four hand-made backups of one file (`config.yaml.bak`, `.pre-acc52`, `.pre-coospo`, `.pre-ppi-1646`) are
sitting in the working tree** — the comment-free ones are machine-emitted; the human re-authored the comments by
hand afterwards (`.pre-ppi-1646` has 18 again).

> **Verifier correction.** Real mode is 0664 → 0600, and the permission clause should be **dropped**:
> narrowing a config the code itself calls world-readable is a security *improvement*, and no consumer reads it
> as another user.

**Fix.** Either round-trip with `ruamel.yaml` in `_save()` only (one dependency; SOUP note in
`docs/COMPLIANCE/`), or accept the loss and stop hiding it — document that the UI owns the file and keep the
human's comments somewhere the writer cannot reach.

---

## E · Robustness and latent defects

**E1. Five async subprocess wrappers abandon a live child on timeout** — `link_rssi.py:115`, `host_clock._run`,
`clockcfg._run`, `storage_targets._run`, `capture._adapter_cmd`. `await asyncio.wait_for(proc.communicate(), t)`
cancels the *await*, not the process. `bonding._btctl` is the only sibling that calls `proc.kill()` — the fix
and the proof.
```
link_rssi._run       returned None       after 1.00s ; live children: {'1354774': 'S'}
host_clock._run      returned (127, '')  after 1.00s ; live children: {..., '1354801': 'S'}
storage_targets._run returned (124, ...) after 1.00s ; live children: 4
```
> **Verifier correction.** The exposure arithmetic is inflated by ~2 orders of magnitude: `rssi_poller` calls
> `read_rssi` only for devices STATUS says are `connected`, so on a wedged radio it skips entirely, and after 3
> misses it backs off to 600 s. Ship the defect, drop the "~576 orphans/h" figure. `bonding` should also
> `await proc.wait()` after `kill()` to reap.

**E2. `build_start()` picks the narrowest offered full-scale range** — `polar_pmd.py:184` takes
`settings[0x02][0]`, and every Polar menu observed lists ranges **ascending**, so the H10 ACC gets ±2 g out of
`[2,4,8]` and the Verity gyro ±250 dps out of `[250,500,1000,2000]`. Which menu the device offers depends on its
state, so the same sensor silently runs at ±250 dps on some sessions and ±2000 on others under an identical
`X [dps]` header, and **nothing in the written file records which was used**.
> **Verifier correction.** The gyro-clipping sub-claim is **refuted**: all six 250-dps files scanned in full,
> max |v| = 217.979 dps, zero samples ≥ 249.99. Real motion above 250 dps does occur in the 2000-dps files
> (405/368/357 dps), so the narrow range is a demonstrated **hazard**, not observed corruption. The H10 ACC
> "pinned at ±2000 mg on 9 of 23 nights" is 15 samples out of 19 837 440, in runs of 1–3 rows — state it that
> way or the finding dies on first inspection.

**Fix.** A `_PREF_RANGE` table beside `_PREF_RATE` with `chosen_range()` mirroring `chosen_rate()`, used by
**both** `build_start()` and `axis_scale()` so they cannot diverge; and record the negotiated range per file
(the `LinkLogWriter` header comment is the established precedent for a per-file constant).

**E3. `size_kb` drops the `G` its own listing regex accepts** — `cpap_harvest.py:72/82` (filed twice, one
defect). `'2.5GB' → 0.0024 KB`, so a complete download reads as a short read and re-fetches forever. Producer
(`_ROW`, `[KMG]?B`) and consumer disagree inside one file. **Latent** — the real ResMed card's listing is
integer-KB throughout, largest observed 2613 KB. One-line fix plus a parametrised test case.

**E4. `due_now`'s window does not wrap midnight** — `cpap_harvest.py:128`. `int(at_hour) <= h < int(at_hour)+window_h`
on a value that wraps mod 24.
> **Verifier correction.** The hunter's `at_hour: 22` example used `window_h=4`, which no caller can reach.
> With the shipped `window_h=2` the **only** reachable clip is `at_hour: 23` → a 1-hour window. Mild; the default
> 13 is unaffected. Fix: `((h - at_hour) % 24) < window_h`, keeping the once-per-day key on the window's **start**
> date.

**E5. The wpa backend hardcodes `wlp1s0` and then blames `wifi_profile`** — `cpap_harvest.py:258`.
`WPA_IFACE = "wlp1s0"` is a module constant with no config key; `backend()` returns `wpa` whenever `nmcli` is
absent, which the module's own comment says is precisely the vigil box. On that branch `profile` is **dead** —
yet `capture.py:2794` reports `Wi-Fi profile 'ezshare' would not come up safely`, naming the one setting that
branch never reads, and `config.example.yaml:166` documents `wifi_profile` as the only Wi-Fi knob.
```
nmcli on PATH? None -> backend() = wpa ; WPA_IFACE = wlp1s0 ; host has wlp10s0
LOG WARNING: cpap: sudo -n ip link -> rc=1 Cannot find device "wlp1s0"
```
> **Verifier correction.** Severity drops to **robustness**: it is not silent (`STATUS['cpap'] state='error'`
> with a detail, plus a WARNING per failed command). The defect is that the surfaced reason is **misleading**.

**Fix.** Add `cpap.wifi_iface`/`cpap.wifi_addr` (default: first `wl*` from `/sys/class/net`, not a literal),
thread them through, and fail fast with a named reason when the interface does not exist. **Note:** the live box
is reporting `cpap.state: "error"` right now — see §Punch-list.

**E6. The test suite reached past its sandbox into real host systemd** — `deploy/check-system-files.sh:108`,
`tests/test_deploy_sync_apps.py:149`. The script ran `udevadm control --reload-rules` + `systemctl daemon-reload`
unconditionally whenever it installed >0 files; the tests drive it with `--install` and `TEPNA_ETC_*` redirected
to a tmpdir, so they installed into a tmpdir and **reloaded the real host's systemd** — which for a desktop user
is a blocking polkit password dialog, hidden from test output by `2>/dev/null`. Journal evidence:
```
polkitd: Operator of unix-session:3 FAILED to authenticate to gain authorization for action
org.freedesktop.systemd1.reload-daemon ... [systemctl daemon-reload] (owned by unix-user:michal)
```
14 such prompts in 20 minutes; pytest blocked on each until cancelled. **A guard is applied in the working tree
but is UNCOMMITTED** (`ETC_SYSTEMD`/`ETC_UDEV` must equal the real paths before reloading) — the tree was on
another session's branch, so it was deliberately not committed. The class to sweep is *any test or script that
reaches past its sandbox into real host state*.

---

## F · What NOT to chase — investigated and REFUTED

Per `AUDIT-PROMPT.md`, a claim disproved by execution is a deliverable. Five died:

| claim | killed by |
|---|---|
| `_wpa_down()` returns True even when all three teardown commands fail — dishonest verdict | Behaviour reproduces exactly, but **the value is dead**: all five callers discard the return (`webmon.py:186` bare call in a `finally`; `cpap_harvest.py:350` followed unconditionally by `return False`; `capture.py:2753/2761/2807`). None assigns, tests or branches on it. |
| `archive.target`/`archive.schedule` are read by the daemon and documented nowhere | The raw observation holds (`config.example.yaml` documents only `enabled/dest/poll_sec`) but the conclusion does not: `monitor.html:518-560` ships the full offload-target editor and `storage_post` is what writes those keys — the UI **is** the documentation surface. Residual is a two-key doc gap at the bottom rung, not a contract defect. |
| `deploy/ezparse.py` is a dead, diverged clone of `parse_listing` | Exactly one reference exists — `CPAP-AUTOHARVEST-2026-07-26-BRIEF.md:77` cites it as the **parser-trap exhibit** ("a working regex is in `deploy/ezparse.py`"). 14 lines, single commit, same commit that added `cpap_harvest.py`. It is a referenced artefact, not orphaned code. At most it wants a one-line "reference only" header. |
| Verity ACC files at ~413 Hz on 2026-07-19/20 are a decode bug | Not a bug — the device menu offers `rate_hz=[26,52,104,208,416]` and 416 Hz was negotiated. Self-refuted by the units hunter before filing. |
| The 386 "gaps > 40 ms" in an O2Ring `_PPG.txt` PHONE column (25.9 s over 3178 s) are lost samples | Not lost: `rows/wall` sits at nominal across the same file, so nothing is missing — the phone column is jittery arrival time, not sample time. Self-refuted before filing. |

Two cautions the charter asks for: a refuted claim is **not** a cleared area, and three of the CONFIRMED
findings above (A2, A3-rider, C4) had their *supporting narrative* refuted while the defect survived — read the
"verifier correction" blocks before writing any fix commit message.

---

## G · Scope — what this audit did NOT cover

State this plainly so a green area is not mistaken for a verified one:

- **The browser lane entirely.** `Dex-Test-Suite.html?full`, `verify-provenance.html` and the render-coverage
  rigs were never opened — no browser in this environment. Nothing here moves a `manifestHash`, so nothing here
  requires them; but they are **unverified**, not passing.
- **The Dex suite itself** — this pass is `capture-host/` only. A separate fleet-wide pass is running.
- **`capture.py` is 3159 lines and was not read in full.** Covered: the O2Ring/Viatom/OxyII runners,
  `rssi_poller`, `alert_poller`, `qc_poller`, `storage_poller`, `keep_running`/`supervise`, the watchdog and the
  clock anchors. **Not covered:** ~15 remaining swallowed `except` sites (lines 344, 359, 368, 422, 442, 507,
  943, 978, 1516, 1787, 1899, 1966, 2004, 2028, 2085).
- **No hardware exercise.** Every clock scenario is a simulated `time.monotonic`/`datetime.now` pair. A real NTP
  step, a real suspend/resume and a real DST crossing on the box are untested. One measured-but-unresolved
  residue: the **backward** NTP step re-anchors and the written Phone column genuinely rewinds (≈ −30 s
  mid-session) — credible, unfiled, needs a decision.
- **Frame decoders were not differentially diffed** (`polar_pmd` vs `oxyii` vs `viatom` bit-packing, delta
  frames, resync-to-lead-byte). That is a numeric-equivalence pass of its own.
- **`polar_psftp.py`, `oxyii.py` (below the live-frame mapping), `bonding.py`'s session machinery, `diskguard`,
  `adapter_ab`, `probe_oxyii_ppg`** — read in passing, no executed repro.
- **`pull_session.py`'s partial-download path**: on a mid-transfer `asyncio.TimeoutError` the loop breaks and
  the short buffer is still written to the final `.dat` — noticed, not reproduced.
- **`monitor.html`'s client side** — XSS/escaping of device names and error strings was not audited.
- **No deploy script was executed** (hard rule). Findings about them come from reading plus faithful
  re-implementation. The **real vigil box's live host state** (`/etc/systemd/system`, `/srv/tepna/app`, the
  installed Caddyfile, which interface is actually `wlp1s0`) was never inspected — C7 and E5 are judged from the
  repo, and confirming them on the box is a follow-up.
- **`/run/media/michal/data/tepna-archive` is not mounted here**, so the archive mirror's real contents (and
  therefore C4's live shortfall) could not be measured.
- **`PPG_INVALID` (156 / 0x9C)** is still written raw into every O2Ring `_PPG.txt`; `oxyii.py:246-257` documents
  that "no consumer rejects it". Not audited downstream in this pass.

---

## H · Prioritized punch-list (correctness first)

| # | finding | why first |
|---|---|---|
| 1 | **A1** DST/tz shift never expires | Corrupts the **filename, folder and stamp column** of every night after one autumn clock change, permanently, and no gate sees it. It is also the cheapest to get wrong twice — fix the *lifetime*, not the arithmetic. |
| 2 | **A4** timeline coverage (three mechanisms) | The operator-facing "% captured" badge is wrong in **both directions** on real corpus today (16.7 % and 196.7 %). |
| 3 | **A2** nightqc drops the pre-outage half | Grades a half-lost night `ok: true`, and came within 85 s of firing on 2026-07-24. |
| 4 | **A3 + rider** O2Ring grid rate | ~+9 s/h of fabricated elapsed time on the finger-PPG leg used for HRV; the shipped checker then mislabels the result unrepairable. |
| 5 | **C1 + C2** alerting can be silenced with no trace | The failure mode that makes every other guard optional. Both are the same one-line pattern `qc_poller` already implements. |
| 6 | **C4** `.archived` latch + retention | The only finding that **deletes data** rather than mis-stating it. |
| 7 | **C5** CPAP 0–2 % truncation band | Live area (branch `fix/cpap-interlock-streaming`); a truncated EDF is accepted, reported ok, and never repaired. |
| 8 | **C3** watchdog `connected` ≠ `streaming` | Same confusion as `1f6bcdf`, same day, one module over. Suppression-only, so below the above. |
| 9 | **D1 + D3** storage POST wipe + `_body` | Fix together or the 400 masks the wipe. |
| 10 | **E6** tests reaching real host systemd | Blocks the test suite for any desktop developer; guard already written, needs a home branch. |
| 11 | **D2 + D4 + D5**, **C6**, **C7**, **C8**, **B1**, **B2**, **E1–E5** | Ordered as filed; D2/D3 belong on `VIGIL-DEEP-ANALYSIS §2A` as partially-executed, not as new items. |

**Immediate operational note:** the live box reports **`cpap.state: "error"`** as of 2026-07-26 21:4x, with
`enabled: true`, `at_hour: 13`, dest `/srv/tepna/captures/cpap`. E5 and C5 are both plausible causes. Pull the
`detail` string off `/api/state` before fixing blind.

**Gate for every item above:** `capture-host/.venv/bin/python -m pytest tests/ -q` (1391 green at baseline).
No bundle, no `manifestHash`, no fixture, no `Dex-Test-Suite`, no `verify-provenance`. Each fix lands with a test
that **fails against the current code** — several of these defects are currently *pinned green* by an existing
assertion (`test_settings_save_failure_is_swallowed`, `test_o2ring_ppg_gap.py:170`, `test_nightqc.py:147`,
the ppg-stream-only prune test), so changing those assertions **is** part of the fix and must be called out in
the commit message.

**Follow-up brief owed on execution:** per `CLAUDE.md`'s lifecycle, spawn
`CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-YYYY-MM-DD-BRIEF.md` for what surfaces while fixing — the §G gaps
(backward-NTP-step rewind, the frame-decoder differential, the real-box confirmation of C7/E5) are already
queued for it.

---

## I · Execution record (2026-07-26)

All 11 punch-list groups executed, in punch-list order, on `claude/capture-host-deep-audit` off
`origin/main` (a private worktree — §👥). **Gate: capture-host pytest 1391 → 1471 green.** Out-of-suite
throughout: no bundle, no `manifestHash`, no fixture, no `Dex-Test-Suite`, no `verify-provenance`.

| # | finding | commit | tests |
|---|---|---|---|
| 1 | **A1** absorbed DST/tz shift never expired | `bfd07e8` | 4 RED-first + 1 control + 5 counter |
| 2 | **A4** timeline coverage, three denominators | `b571223` | 7 RED-first + 2 controls |
| 3 | **A2** nightqc discarded the pre-outage half | `f59ce72` | 2 new + 1 **inverted** |
| 4 | **A3 + rider** O2Ring grid rate / attribution | `73e3197` | 6 new + fixture rebuilt |
| 5 | **C1 + C2** alerting could be silenced | `2a0927b` | 5 RED-first |
| 6 | **C4** `.archived` latch + retention | `3aa9a01` | 5 new + 2 fixtures corrected |
| 7 | **C5** CPAP 0–2 % truncation band | `df0fb1e` | 2 new + 3 **inverted** |
| 8 | **C3** watchdog `connected` ≠ `streaming` | `6cd0b3e` | 2 RED-first + 2 controls |
| 9 | **D1 + D3** storage POST wipe + `_body` | `ff0c51c` | 4 RED-first + 1 control |
| 10 | **E6** tests reached real host systemd | `4c7a4f8` | 3 new |
| 11 | **B1 B2 C8 E3 E4 E5** / **D2 D4 D5 C6 C7 E1** | `f59508e`, `b90501e` | 16 RED-first + 4 controls |

**Every fix landed with a test verified RED against the pre-fix code**, and each over-correction risk
carries a control verified green in BOTH directions. Six assertions that PINNED a defect green were
deliberately inverted and are called out in their commit messages:
`test_settings_save_failure_is_swallowed` (§D2 — the assertion *was* the defect),
`test_nightqc.py`'s `ok is True` on an excluded session (§A2), `short_read`'s "29 KB is rounding
tolerance" plus two CPAP siblings (§C5), and the source scan asserting `os.remove(path)` (§C8).

### What execution changed about the findings

Three corrections the brief could not have known, all found by running the code:

- **§A3's obvious fix is a runaway.** Estimating the sample step across an inserted gap raises `idx`
  while elapsed does not move, which lowers the apparent period, raises the rate, makes `target`
  outrun `idx` and inserts MORE gaps. Measured **+1.04 % inflation and 118 phantom gaps on a
  ZERO-LOSS stream** — worse than the defect. The estimator measures loss-free stretches only.
- **§A3's test file re-implemented the code it tested**, with a note claiming it was "kept
  deliberately in step". It was not, and could not be. That is *why* the one-sided correction stayed
  green. The grid moved into `capture.O2PpgGrid` and the tests drive it.
- **§C7's owned bundles were never broken.** The audit's "19/19 refs MISSING" counted
  `data-inline-src="…"` — the bundler's record of what it INLINED — because that attribute ends in
  `src="`. The unbundled `*.src.html` twins and the harnesses genuinely were broken; the shipped
  bundles resolve completely. Verified after the fix: 65 served pages → 23, all 11 owned bundles
  resolve every reference.

**§E6 was measured, not just described:** its two tests take **25.1 s** against the unguarded script
and **0.33 s** guarded, and the full suite fell from **87 s to 37 s** — ~50 s per run of polkit
timeouts.

### Deviations from the prescribed fix

- **§D1.** The brief's Fix says `"target" not in body` should leave the target untouched; its own
  verifier correction says that is the *designed disable path*, used by monitor.html and four tests.
  The correction wins. The distinction drawn is between an object that omits the key (an instruction)
  and no object at all (a request that never arrived) — which closes the reported repro without
  breaking the UI contract.
- **§D5.** `ruamel.yaml` was not adopted: a runtime dependency for comment preservation is a SOUP
  entry on a 62304-aligned appliance. The loss is announced instead (a banner in the emitted file, one
  journal warning per process) and `config.example.yaml` is named as where prose survives.

Follow-up: **`CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md`**.
