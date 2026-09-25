<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED (**TRIAGED 2026-09-25 (Wren, tree; rule 0: "absence survey every device run length zero sentinel corpus")**: in execution under Osprey; §7's three boxes are all unticked, for these reasons. (1) The route question (a)/(b)/(c) is answered in practice as (c), sequenced (node-side HIGH refusals first, capture-host rows into `SAMPLE-VALIDITY-ENVELOPE`), per the owner's 2026-09-23 assignment below. The box stays unticked because no owner ruling on (a)/(b)/(c) is recorded as such. (2)+(3) CANNOT BE COUNTED FROM THE TREE: `audits/ABSENCE-SURVEY-2026-09-22.json` carries `counts` / `confirmed` / `refuted` and NO per-row fix state, so how many of the 290 confirmed rows have since landed a fix with a planted control is untracked. A keyword log search would count §∅ commits in general, not survey rows. Next step, Osprey: give the confirmed rows a `fixedBy` / state field, or re-run the survey, before claiming progress. The draft-bank reconciliation this header says is "owed" is DONE: `2026-09-23-draft-bank-crossed-against-the-absence-survey` is `fixed #2923`. · EARLIER: owner-assigned to **Osprey** 2026-09-23 — state re-verified from the artifact that day, not from the relay: `audits/ABSENCE-SURVEY-2026-09-22.json` recomputes to **923 raw = 290 confirmed + 633 refuted, 0 unjudged**, severity **78 high / 159 medium / 53 low**, and the `kind` field carries the families so §2 closes arithmetically — `default-reads-as-measured` 106 = F1 · `default-number` 119 = F2 · `in-band-sentinel` 24 = F3 · `aggregate-over-absence` 39 + `discontinuity-annotated` 2 = 41 = F5 · F4 = 0. **ROUTE, and it is a correction to the either/or §5 offers:** the two routes are COMPLEMENTARY, not alternatives, and the split that decides the order was not in the brief — **65 of the 78 high rows are node JS, only 13 are capture-host** (251 of 290 overall). The sidecar is a CAPTURE-side mechanism: it SUPPLIES validity, and a node still has to REFUSE on it, so a `?? 0` in a DSP is not discharged by a sidecar landing. Taking the node-side refusals for the HIGH rows first — the largest high block and the one that does not block on the envelope — and carrying the 13 capture-host rows into `SAMPLE-VALIDITY-ENVELOPE`. Unchanged and not re-litigated: NOT 290 residue rows. ⚠️ One reconciliation owed before any of it lands: 16 of the 384 drafts in the machine-local mutation bank sit on confirmed rows and two state the violation AS THE SPEC) · **Created:** 2026-09-22 · **Owner:** Osprey · **Relates:** CLAUDE.md §∅ · `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` · `FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md` (DONE) · #2897 (the motivating case)

# §∅ Absence survey — every place "not measured" is a number, fleet-wide, adversarially verified

> **Read §0 before quoting a number.** A "confirmed" row is a hypothesis with two independent adversarial
> readings behind it, not a measurement. **The verification is now COMPLETE** — the run that was cut by the
> weekly token limit at 179 of 921 judgements was resumed and finished: **921 of 923 findings judged, 0 left
> unjudged.** The counts below supersede the first published version of this brief (923 raw, 33
> confirmed, 744 unverified).

## 0 · How this was produced

- **Surface:** the runtime tree of `origin/main` at 2026-09-22 (root `*.js` + `capture-host/*.py`; `tests/`,
  `tools/` and `*_test.py` excluded) — **236 files, 164,376 lines**, read in **130 units** of ≤ 2,500 lines by
  one Opus finder each. Findings were classed by the five shapes CLAUDE.md §∅ names, with its "do not flag"
  list (a genuinely-zero count; an accumulator that carries `n`; a documented refusal; a device-emitted byte
  stored faithfully) in every finder's instructions.
- **Raw yield: 923 findings.**
- **Verification:** two independent lenses per finding — A *"is it really absence?"* and B *"does it reach a
  consumer that cannot tell?"* — each instructed to **default to refuted**, a finding kept only when NEITHER
  refuted. Pass 1 (one agent per finding, capped at 5 per unit) judged 179 before the token limit; pass 2
  (one agent per file-group, 398 agents, 0 errors) judged the remaining 744.
- **Result: 290 confirmed · 633 refuted · 0 unjudged.** The **68 % refutation
  rate** is the honest calibration of the finders: most of what reads as fabricated absence on one reading is a
  measured zero, a documented refusal, or a value that never reaches an output.
- **What this is not:** not a measurement of prevalence in the sense of a defect density — the finders were
  instructed to over-report and the lenses to over-refute — and not a fix. Each row is a candidate for the
  sidecar programme (`SAMPLE-VALIDITY-ENVELOPE`) or for a one-PR refusal fix.
- **Provenance:** every finding, both lens verdicts and every refuting reason are committed beside this brief
  as `audits/ABSENCE-SURVEY-2026-09-22.json`, so nothing is re-derived and no refuted item is re-found.
- **Motivating case (fixed the same night, #2897):** ECGDex displayed rMSSD 10,608.5 ms on the owner's
  2026-09-21 night — the whole-record path excluded gap-straddling intervals, the per-epoch engine did not, and
  the DISPLAYED value was the epoch median.

## 1 · What the completed verification changed

| | first published | complete |
|---|---|---|
| judged | 179 of 923 | **921 of 923** |
| confirmed | 33 | **290** |
| refuted | 146 | **633** |
| unverified | 744 | **0** |

The first version predicted "on the order of 130 more real instances" from an 18 % survival rate on the
capped sample. The measured survival on the remaining 744 was **34 %**, i.e. **257** — roughly
double the projection. The projection was made from a population biased toward the highest severities
(pass 1 verified at most 5 per unit, highest first), and it under-predicted anyway: the per-file groups in
pass 2 gave each lens the whole file's context, and context makes a claim easier to confirm as well as to
refute.

**Confirmed by severity:** 78 high · 159 medium · 53 low.
**By shape:** default-number 119 · default-reads-as-measured 106 · aggregate-over-absence 39 · in-band-sentinel 24 · discontinuity-annotated 2.
**Concentration:** `oxydex-dsp.js` 39, `oxydex-render.js` 28, `ecgdex-dsp.js` 17, `ppgdex-dsp.js` 16, `hrvdex-profile.js` 8, `integrator-dsp.js` 8, `resp-acc-analysis.js` 8, `capture-host/capture.py` 7.

## 2 · Mechanism families

### F1 · "COULD NOT LOOK" FOLDED INTO "LOOKED AND SAW NOTHING"  (106 confirmed)

A failed scan, an unanswered GATT read, an unparseable file, a truncated listing or an unreadable record returns the SAME empty value (`{}`, `set()`, `[]`, `0`, `(None, 0)`) a genuine "observed, nothing there" returns, and the consumer folds it as an observation. **Remedy:** the refusal is a distinct value — `None`, or `{ok:false, reason}` — and the fold is SKIPPED rather than fed an empty observation; a positive verdict (`stopped_confirmed_by_device`, `left_clean`, `manifest.ok`, `completeness = COMPLETE`) is published only over answered reads, with the unanswered count beside it.

### F2 · A RATE OR GEOMETRY DEFAULTED, THEN SPENT AS A TIMEBASE  (119 confirmed)

`fs || 1`, `fs: 0`, the vendor `SAMPLE_HZ` default, a 1000 ms cadence, `sampPerRec || 0`, a 1.0 s span constant, an MTU of 23 — each is a legal value of its own quantity, so a consumer converting samples to seconds (or bytes to records) cannot tell the default from a negotiation. **Remedy:** an unknown rate or geometry is `null` and the node REFUSES the dependent quantity with a named reason (`rate-unknown`); a default that must exist for transport is logged as `assumed`, never published as `negotiated`.

### F3 · A CLOCK FABRICATED WHERE THE STAMP WAS ABSENT (Clock Contract §2.6/§2.7, at the box AND in the nodes)  (24 confirmed)

`time.time()` for an unobserved close instant, `t0Ms || 0` (epoch 0 is a legal floating tMs), `Date.UTC` rolling an invalid stamp onto a plausible instant, a literal `0` where every sibling passes `None` for "no device clock", a negative age clamped to the freshest possible value. **Remedy** is the contract as written: null, never now(); `_ckMk`-style component validation; `None` as the only absence a sidecar recognises.

### F4 · A FAULT OR AN UNCLASSIFIABLE INPUT COLLAPSED INTO A BENIGN STATE  (0 confirmed)

Contact 2/3 (probe fault) → `worn: False` (a lead-off); an undecryptable reply → plaintext; an unknown PPG rate → "calibrated"; a power law outside the five named → clamped to the nearest named; an unmeasured elevation → "~ sea level". Each publishes a confident benign reading about a state the path could not classify. **Remedy:** a third value (`unknown`/`fault`) the consumer must handle, and the classifier refusing (`None`) rather than clamping.

### F5 · AN AGGREGATE OVER AN AXIS THE ABSENCE SHORTENED  (41 confirmed)

A doff instant counted in rows rather than read from a row's own stamp; a padded EDF record; a mean over a window whose gaps were compacted out. The absent samples do not leave a hole — they move every later point. **Remedy:** derive instants from stamps, never from counts, and publish the covered span beside the value (the ruling CLAUDE.md §∅ already gives: a discontinuity refuses, reduced coverage annotates).

⚠️ **F5 IS TWO KINDS IN THE DATA, AND THE FAMILY ARITHMETIC ONLY CLOSES IF YOU COUNT BOTH** — a
picker-up checks that first, so: the rows carry no `family` field, `kind` is the family key, and F5 is
`aggregate-over-absence` **39** + `discontinuity-annotated` **2** = 41. (The rest: F1 =
`default-reads-as-measured` 106 · F2 = `default-number` 119 · F3 = `in-band-sentinel` 24 · F4 = 0.)

The 2-row kind is not a rounding detail — **it is the exact boundary the §∅ ruling governs**, which is why
it is named apart rather than folded into the 39. Both rows sit on the line between refusing and
annotating, and both are `low` only because of what consumes them:

- `capture-host/writers.py:1544` — a RESUMED ECG file whose per-file anchor (`_first_ns`) could not be
  recovered, so the relative `timestamp [ms]` column has no measured origin. That is a DISCONTINUITY, so
  the ruling says it **refuses**; today it is absorbed and spent by `ecgdex-dsp.js` `ecgCoverage`
  (`ecgCoverage`).
- `glucodex-render.js:321` — a CGM dropout where `glucodex-dsp.js:490/496` wrote a **linear
  interpolation** into `gV` and the minimap draws an unbroken pen across it. A dropout is reduced
  COVERAGE, which annotates — but the fabricated value is a §∅ violation on its own, before the drawing
  question is reached.

Every confirmed row is **path-manufactured**, so in every case the fix is ours and the recording is not
touched (§∅: captured bytes are immutable; correction lives beside the file).

## 3 · Confirmed findings — HIGH severity

| # | file:line | family | absence → representation | consumer |
|---|---|---|---|---|
| 1 | `capture-host/allan.py:655` | F1 | a series whose identified power law falls outside [-2,+2] is NOT one of the five laws this names — i.e. the identification failed → `alpha = 2 if alpha > 2 else (-2 if alpha < -2 else alpha)` | stability() line 898 `"lag1_noise": noise_id(phase)`; the record is published beside `classification` as "a second, inde |
| 2 | `capture-host/capture.py` `_presence_scan_loop` | F1 | a BLE scan window that FAILED — the radio could not look, so nothing is known about any ring in that window → `except Exception as e: log.info("presence scan failed (%s) — observation unchang` | presence_fold (`capture.py` `presence_fold`) → oxy_presence.observe(seen_at=None) (oxy_presence.py:118), whose docstring defines see |
| 3 | `capture-host/mmeta.py:112` | F1 | whether mutmut generated any mutants under this glob — the mutants file is missing or unreadable, so nothing was counted → `except OSError:         return 0   # in generated_count(work, module, glob)` | `capture-host/tools/mutate_diff.py` `generated_count` |
| 4 | `capture-host/mutation_diff.py:146` | F1 | "the module's source could not be parsed, so WHICH functions cover the changed lines was never determined" → `except SyntaxError:         return set()` | tools/mutate_diff.py:299-302 — `stems = functions_covering(_msrc, lines)` then `if not stems: print(f"  {module}: {len(l |
| 5 | `capture-host/night_report.py` `back_check` | F5 | an end-of-night class-B back-check population that is empty or silently reduced — nothing was captured, or every capture file was → `return ("fail" if (clips or held) else "ok"), clips, held` | /home/michal/wt-absence-survey-kst/capture-host/night_report.py:227 (report['line'] / report['back_check'], rendered at |
| 6 | `capture-host/o2ring.py:342` | F1 | the plaintext of a reply that could not be decrypted with the session key — the reply content was NOT recovered → `except ValueError: self.errors += 1; print(...did not decrypt...); return payloa` | Cipher.unwrap -> read_reply() line 397 puts the bytes in msg["payload"]; file_list() lines 484-490 then reads count = p[ |
| 7 | `capture-host/oxyii.py:702` | F1 | wear state is UNKNOWN when the sensor reports 2 (probe unplugged) or 3 (probe/sensor fault) — the ring cannot say whether the fing → `"worn": contact == 1,   # ONLY 1; 2 and 3 are faults, not wear` | `capture.py` `run_oxyii` `_set(name, worn=live["worn"], … last_error=None if live["worn"] else "no finger contact")`, and oxy_pow |
| 8 | `capture-host/polar_psftp.py` `pull_recording` | F5 | files that were never enumerated because a directory listing inside the session came back TRUNCATED (recorded in `fs.truncated_dir → `manifest["ok"] = not got["short"]` | `capture.py:8014` `pull_polar_offline_all` returns `{"sessions":…, "ok": not short}` and `webmon.py:1688` surfaces the s |
| 9 | `capture-host/probe_oxyii_opcodes.py:168` | F1 | the post-opcode live-frame snapshot failed (send() returned None on timeout), so NO state read exists for this opcode → `if not base or not after_hex or not stable:         return []` | /home/michal/wt-absence-survey-kst/capture-host/probe_oxyii_opcodes.py:286 |
| 10 | `capture-host/probe_pmd_surface.py:535` | F1 | the BEFORE-write sample stamp was never obtained (sample_stamp returned None: device not advertising, no start command, or a 10 s → `moved = before.get("device_stamps") and after["device_stamps"][:16] != before["d` | _clock_conclusion's own fall-through return at line 542 — `f"SET_LOCAL_TIME accepted; sample clock unchanged. {after['ve |
| 11 | `capture-host/probe_verity_survey.py:335` | F1 | the device never answered the status query (cp.send returns None on a 6 s timeout, or the notification was lost) → `after = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b"")  … got` | got["stopped_confirmed_by_device"] (line 338), the survey's primary safety verdict, via pmd.is_recording → status.get(me |
| 12 | `capture-host/probe_verity_survey.py:587` | F1 | the unconditional safety backstop's status read timed out / returned no reply → `before = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b""); acti` | out["left_clean"] = {"was_active": [...], "still_active": [...]} (lines 592-596), the report field that asserts nothing |
| 13 | `capture-host/sealbox.py:280` | F1 | the night's close time when the directory yields no file mtimes (no files, or every file disappearing between the caller's count a → `newest = max((os.path.getmtime(p) for _, p in _seal._night_files(night_dir)), de` | seal_or_reissue() line 369 passes it as closed_at_ms= into _seal.seal_night, which writes it into the sealed header; eve |
| 14 | `cohort-worker.js:162` | F2 | the night's sample interval, when durationMin was not produced by processNight → `var dt = st.durationMin && rows.length ? (st.durationMin * 60000) / rows.length` | detTMs (line 171) -> score.nights[].detectedDesatTMs, the per-event absolute timestamps the harness scores against plant |
| 15 | `cpapdex-cross.js:650` | F3 | a missing recording start stamp on the live or SD channel (buildCompareSets line 770 can produce undefined via `live.clock && live → `var clockOffsetSec = ((a.t0Ms \|\| 0) - (b.t0Ms \|\| 0)) / 1000;` | compareChannel() publishes clockOffsetSec and alignmentOffsetSec, and lines 652-668 use the same coerced values to decid |
| 16 | `cpapdex-dsp.js:361` | F1 | largeLeakPct is unmeasurable (no leak channel, or mask never on) — the leak-quality evidence that sqi is defined over does not exi → `if (ll == null \|\| isNaN(ll)) return 1;` | cpapdex-fusion.js:328 (export quality.sqi) and cpapdex-render.js:527 (per-event 'sqi' display) |
| 17 | `cpapdex-dsp.js:2184` | F2 | the STR record index is past the end of the Mode signal's data — _strAt returns null for 'sample absent' → `var modeCode = modeSig ? Math.round(_strAt(modeSig, r, 1, 0)) : null;` | cpapdex-render.js:161 (deviceMode chip, badged via cpapdex-registry.js:48) |
| 18 | `cpapdex-edf.js:239` | F2 | one signal's samples-per-record header field unparseable/absent (blockInt → null) → `return a + (b \|\| 0);` | bytesPerRecord (line 241) → dataStart/record offsets in the decode loop (lines 279–315) → every sample value in signals[ |
| 19 | `cpapdex-edf.js:263` | F2 | record duration missing/unparseable in the EDF header (asciiNum → null), so the sampling rate is UNKNOWN → `fs: recDurSec ? spr / recDurSec : 0` | `cpapdex-dsp.js` `buildSessionFromEdf` `var fs = pressCh ? pressCh.fs : 0.5;` (mask-on detection) and :153/286 `ch.fs \|\| targetFs` / `raw.f |
| 20 | `cpapdex-edf.js:310` | F1 | an unparseable/absent physical or digital calibration header (asciiNum/asciiInt return null for a blank or garbage field) → `var scale = (pMax - pMin) / (dMax - dMin \|\| 1);` | signals[label].data, read by cpapdex-dsp.js:161/286/321 (resample + all pressure/flow metrics) |
| 21 | `dex-profile.js:1010` | F1 | elevation never entered — popDefaults() deliberately returns `elevation: null` (lines 210–218) precisely so an unmeasured altitude → `r.v > 1500 ? '⛰ ' + … : '~ sea level · adjusts above ' + toDisp('elevation', 150` | _sub() → renderPanel build(), line 1159: `html += '<div class="prof-sublabel …">' + (sub[1] \|\| '')` — the profile panel' |
| 22 | `ecgdex-app.js:1611` | F3 | the recording carried no parsable start stamp (t0Ms === null, the Clock Contract §2.6 honest null) → `const t0 = r.t0Ms != null ? r.t0Ms : 0; // undated recording → relative-from-0 (` | hrvdex-dsp.js:176 |
| 23 | `ecgdex-app.js:1643` | F3 | same absent recording anchor (t0 defaulted to 0 at line 1640) → `const ts = new Date(t0 + r.tt[i] * 1000).toISOString().replace('Z', '');` | pulsedex-dsp.js:962 |
| 24 | `ecgdex-dsp.js:2231` | F1 | seconds inside a dropout where no beat was detected — the 1 Hz HR grid is filled by HOLDING the last measured beat's rate flat acr → `hr[s] = 60000 / nn[Math.min(j, N - 1)];` | /home/michal/wt-absence-survey-kst/ecgdex-app.js:697 (CVHR HR chart) and ecgdex-dsp.js:3585 via ecgdex-app.js:983 `DSP.v |
| 25 | `ecgdex-dsp.js:3576` | F5 | seconds of the ECG span for which the device HR file supplied no row at all (link dropout, device off-body, shorter device file) → `for (let s=0;s<M;s++){ if (isFinite(dev[s])) last = dev[s]; else if (isFinite(la` | /home/michal/wt-absence-survey-kst/ecgdex-app.js:983 `renderHRValidation` → the HR cross-check card (r, mae, maxErr, n) |
| 26 | `ecgdex-dsp.js` `ecgTimingResolve` | F1 | no sample rate could be measured from the file at all — no usable ns counter, no [ms] deltas, no provisional step → `var fs = 130;  // then: if (nsUsable) fs=…; else if (scan.stepN>0) …; else if (s` | /home/michal/wt-absence-survey-kst/ecgdex-dsp.js:5530 (`fs: t.fs` on the parsed rec) → refinePeaks/times/durSec and the |
| 27 | `ecgdex-dsp.js` `parseDeviceACC` | F1 | the ACC stream's sample rate when fewer than 6 rows carried a parseable timestamp (no ns column and no parseable phone stamp) → `var fs = 4, ts2 = []; … if (md > 0) fs = Math.max(1, Math.min(200, Math.round(10` | /home/michal/wt-absence-survey-kst/ecgdex-app.js:227 (displays 'ground-truth ACC (N samples @ 4 Hz)') and ecgdex-dsp.js: |
| 28 | `ecgdex-dsp.js` `compute` | F2 | the sampling rate of a canonical ecg SignalFrame that arrived without `fs` → `var fs = input.fs != null ? input.fs : 130;  …  durSec: N / (fs \|\| 130)` | ecgdex-dsp.js:6027 (recording.durSec in the node export) / ecgdex-dsp.js:6507 analyze(rec) |
| 29 | `ecgdex-morph.js:136` | F1 | the beat's signal quality is too low to classify, so its rhythm type was not determined → `if (sqi[k] < 0.55) { types[k] = 'N'; continue; }` | ecgdex-app.js:2476 |
| 30 | `ecgdex-morph.js` `afScreen` | F1 | no 32-beat window had ≥20 usable beats (line 625 `continue`), so AF was never screened → `else verdict = 'no-af';   // reached with total === 0 → suspiciousPct 0 (lines 6` | ecgdex-app.js:2539 |
| 31 | `ecgdex-profile.js:254` | F1 | unknown recording elevation - line 78 deliberately returns null for it ('§∅ — absent ≠ sea level') → `const altF = altVO2Factor(p.elev);   // altVO2Factor: elev <= 1500 ? 1 : ...` | `ecgdex-app.js` `renderKPI` (VO₂max Est KPI) and `ecgdex-app.js` `renderTable` (full-metrics row, which appends '· alt ×' ONLY when altFactor |
| 32 | `glucodex-app.js` `computeFusion` | F3 | a QTc trend point whose tMin (minutes from ECG start) is absent/non-numeric → `const ms = ecgStartMs + (pt.tMin \|\| 0) * 60000;` | glucodex-app.js:1816 |
| 33 | `glucodex-app.js:1120` | F1 | MAGE is null when the recording is too short to compute it (the same file renders it as '—' at L514, L702, L1388 and the export no → `mageR = clamp(((r.mage \|\| 50) - 40) / 80, 0, 1)` | glucodex-app.js:1826 |
| 34 | `glucodex-dsp.js:447` | F1 | the recording's sample cadence was never measurable (no inter-sample delta in (0,240) min — e.g. a spot/daily export, or a single → `const cadence = dts.length ? +quantile(dts, 0.5).toFixed(2) : 5;` | integrator-dsp.js:1440 (recSegments turns durSec into recorded-time intervals) and integrator-dsp.js:2504 (cadenceMin us |
| 35 | `glucodex-dsp.js:920` | F5 | cell i-1 may be WARMUP / COMPRESSION / GAP_LONG — a drawn straight line across hours the sensor never saw → `if (!_ana(c, i)) continue;  const dg = c.gV[i] - c.gV[i - 1];  L += Math.sqrt(dt` | glucodex-app.js:518 (GVP KPI, rendered with no coverage annotation; the r.gvp==null branch never fires because gvp only |
| 36 | `hrvdex-dsp.js:860` | F1 | today's rMSSD was never recorded (numOrNull / _envToSeed n() store it as null) → `r.d_rmssd_delta_pct = dayGap === 1 && prev._rmssd > 0 && !isNaN(r._rmssd) ? ((r.` | hrvdex-render.js:1380 |
| 37 | `hrvdex-dsp.js:879` | F2 | a row with no Welltory subjective Stress column (_stress === null; every ECGDex/Ganglior-ingested row sets _stress: null at line 5 → `const stress7 = window7.map((x) => x._stress).filter((v) => !isNaN(v));` | hrvdex-render.js:808 (ch_stress_auc) and `hrvdex-render.js` `TABLE_COLS` table row 'Stress AUC 7d' |
| 38 | `hrvdex-dsp.js:909` | F2 | missing Welltory Stress values inside the 14-day autocorrelation window (_stress === null) → `if (!isNaN(ac_raw[j]) && !isNaN(ac_raw[j + 1])) ac_pairs.push([ac_raw[j], ac_raw` | hrvdex-render.js:811 (ch_stress_ac series 'Stress Autocorrelation lag-1') |
| 39 | `hrvdex-dsp.js:1074` | F1 | none of rMSSD, pNN50 or HF was measured for this row (paraCount === 0) → `var paraAvg = paraCount ? paraScore / paraCount : 50;` | `hrvdex-render.js` `ch_camq` (ch_camq) |
| 40 | `hrvdex-profile.js:45` | F1 | no morning/any row carried a plausible HR (30<v<120) — resting HR was never measured → `const restingHR = hrs.length ? hrs[Math.floor(hrs.length / 2)] : 60;` | dex-profile.js:496 (resolve → origin 'detected'); hrvdex-profile.js:134 (banner) |
| 41 | `hrvdex-profile.js:353` | F2 | no rows loaded at all — no HR observation exists → `const _hrRest0 = typeof allRows !== 'undefined' && allRows.length > 0 ? Math.rou` | hrvdex-profile.js:508 |
| 42 | `hrvdex-profile.js:378` | F2 | p.vo2gt is 0 whenever no manual VO₂ and no detected VO₂ exist (detOr0 at :213–217 / :238 return 0 for 'unset') → `const vo2_abs = ((p.vo2gt * p.weight) / 1000).toFixed(2);` | hrvdex-profile.js:512 |
| 43 | `hrvdex-profile.js` `updateProfile` | F5 | same unset VO₂ (p.vo2gt === 0); vo2Percentile has no unset branch — :484 returns 1 for any value below the lowest band → `const vo2Perc = vo2Percentile(p.vo2gt, p.age, p.sex);` | hrvdex-profile.js:516 |
| 44 | `hrvdex-render.js:383` | F2 | an absent HRV Score on either today's row or the previous row (_hrv is numOrNull in the DSP) → `delta: prev ? (r._hrv - prev._hrv).toFixed(1) : null` | hrvdex-render.js:573 |
| 45 | `integrator-dsp.js:1089` | F2 | the night's actual sample interval, when stats.durationMin or stats.n is absent → `var dt = durMs && nSamp ? durMs / nSamp : 1000; // O2Ring ≈ 1 Hz` | /home/michal/wt-absence-survey-kst/integrator-dsp.js:1107 |
| 46 | `motiondex-dsp.js:1274` | F1 | the ACC stream's unit was never determined — the header declared nothing recognisable (streamKindFromHeader returns unit:null at : → `var accUnit = (acc && acc._unit) \|\| 'mg', chestUnit = (chest && chest._unit) \|\|` | motiondex-render.js:157 (and integrator-dsp.js:634) |
| 47 | `nsrr-adapter.js:182` | F1 | NSRR PSG EDFs carry no accelerometer/motion channel at all — this adapter never looks for one, so every row publishes 'no movement → `motion: 0` | oxydex-dsp.js:2736 |
| 48 | `oxydex-dsp.js:1355` | F1 | a recording too short (<60 samples) for ODI-1 to be computed at all — the index was never evaluated → `if (n < 60) return { odi1Rate: 0, odi1Total: 0 };` | oxydex-dsp.js:2398 |
| 49 | `oxydex-dsp.js:2353` | F1 | an unmeasured HR floor, and an unmeasured night mean HR → `var floor = hrv.hrFloor \|\| refHR;   // with refHR = stats.meanHr \|\| 60 on :2352` | oxydex-dsp.js:2452 |
| 50 | `oxydex-dsp.js` `computeTIndex` | F5 | seconds with no SpO2 reading (r.spo2 === null on the NSRR/to1Hz, self-ingest and SignalFrame paths) → `var s = spo2.filter(function (v) { return v < t; }).length; out[t] = { secs: s,` | oxydex-dsp.js:4164 |
| 51 | `oxydex-dsp.js:3866` | F5 | seconds with no SpO2 reading → `if (rows[i].spo2 < 94) burden += 94 - rows[i].spo2;   // then: rate = durationHr` | `oxydex-dsp.js` `computeSleepStabilityScore` (s5 = ((15 - hb.rate)/15)*100 → stab.score → oxydex-dsp.js:3838 POOR_STABILITY, exported at oxydex-ds |
| 52 | `oxydex-dsp.js:4194` | F3 | recovery time when the SpO2 never returned to baseline−1 within the 120 s look-forward (or the record ended first) — i.e. recovery → `var recov = 0; for (var k = e.endIdx; k < Math.min(e.endIdx + 120, n); k++) { if` | `oxydex-render.js` `nightDetail` ('Nadir Recov' metric, _dc(...,30,60) colour bands) and oxydex-app.js:350 (CSV export) |
| 53 | `oxydex-dsp.js` `computeComposite` | F1 | autonomic arousal index that could not be computed — computeCrossSignal line 4479 deliberately returns null when durationHr is unk → `var aai = cross && cross.autoArousalIdx != null ? Math.min(cross.autoArousalIdx` | oxydex-dsp.js:3843/3844 (NOCTURNAL_STRESS flag, thresholds >=80/>=60, re-parsed by _flagSev at oxydex-dsp.js:3788) and o |
| 54 | `oxydex-dsp.js:6718` | F1 | a re-loaded export that carries no ODI-4/ODI-3 block at all (the detector never ran / the field was not exported) → `odi4: obj.odi4 \|\| { rate: 0, count: 0 },  odi3: obj.odi3 \|\| { rate: 0, count: 0` | oxydex-render.js:2077 |
| 55 | `oxydex-dsp.js:6726` | F2 | an imported export whose HRV block omits one of these proxies (never computed on that night) → `pnn3: obj.hrv.pnn3 \|\| 0, hrFloor: obj.hrv.hrFloor \|\| 0, hrSlope: obj.hrv.hrSlope` | oxydex-fusion.js:865 |
| 56 | `oxydex-dsp.js:6899` | F2 | an imported summary with no ODI-4/ODI-3 rate and/or no T95 percentage → `var o4r = obj.odi4 && obj.odi4.rate != null ? obj.odi4.rate : 0;  var o3r = ...` | oxydex-render.js:2394 |
| 57 | `oxydex-fusion.js:71` | F2 | the ECG export carries no duration field, so the recording's end time is unmeasured → `var durMin = rec.durationMin != null ? rec.durationMin : rec.durationSec != null` | /home/michal/wt-absence-survey-kst/oxydex-fusion.js:546 (and oxydex-app.js:160) |
| 58 | `oxydex-fusion.js:328` | F1 | the paired ECG's recording window is unknown (rec.startEpochMs null, or no durationMin/durationSec), so which desats it could see → `var coveredDesats = _cov ? Math.max(confirmed, desatMs.reduce(...)) : desN;` | /home/michal/wt-absence-survey-kst/oxydex-fusion.js:550 |
| 59 | `oxydex-render.js:1100` | F2 | a night with no ODI-4 computation at all → `return n.odi4 ? n.odi4.rate : 0;` | oxydex-render.js:1092 (lineChart 'ODI-4 Rate (events/hr) per Night'), rendering via oxydex-render.js:546 |
| 60 | `oxydex-render.js:1249` | F2 | a night with no hypoxic-burden computation → `return n.hb ? n.hb.rate : 0;` | oxydex-render.js:1241 (lineChart 'Hypoxic Burden Rate'), rendering via oxydex-render.js:546 |
| 61 | `oxydex-render.js:1270` | F2 | a night with no sleep-stability score → `return n.stab ? n.stab.score : 0;` | oxydex-render.js:1262 (lineChart 'Sleep Stability Score (0-100) per Night'), rendering via oxydex-render.js:546 |
| 62 | `oxydex-render.js:1389` | F2 | a night with no motion-derived sleep-efficiency computation → `return n.motSleep ? n.motSleep.sleepEff : 0;` | /home/michal/wt-absence-survey-kst/oxydex-render.js:485 |
| 63 | `oxydex-render.js:1400` | F5 | a night in the 7-day window whose mean SpO2 was never computed (stats.meanSpo2 === null) → `w.reduce(function (s, x) { return s + x.stats.meanSpo2; }, 0) / w.length` | `oxydex-render.js` `renderAll` (lineChart '7d SpO₂', 'Chronic drift indicator') |
| 64 | `oxydex-render.js:1476` | F2 | a night with no composite/NSI computation → `return n.comp ? n.comp.nsi : 0;` | `oxydex-render.js` `renderAll` (lineChart 'Nocturnal Stress Index (0-100)'), rendering via oxydex-render.js:546 |
| 65 | `oxydex-render.js:1560` | F2 | a night with no SBII computation → `return n.sbii ? n.sbii.sbii : 0;` | /home/michal/wt-absence-survey-kst/oxydex-render.js:546 (lineChart series point) with the SHHS-quintile legend at oxydex |
| 66 | `oxydex-render.js:1588` | F2 | a night with no pRED-3p computation → `return n.pred3p ? n.pred3p.pred3p : 0;` | /home/michal/wt-absence-survey-kst/oxydex-render.js:546 (lineChart series point) with the SHHS-quintile legend at oxydex |
| 67 | `oxydex-render.js:1746` | F5 | nights with no stability score (n.stab missing) — line 1743 tests `n.stab && n.stab.score < 50` → `var poorPct = +((poorNights / nights.length) * 100).toFixed(0);` | /home/michal/wt-absence-survey-kst/oxydex-render.js:1747 — metric('Poor Nights (<50)', poorPct + '%', poorNights + ' of |
| 68 | `oxydex-render.js:2030` | F2 | a night whose recording duration was never derived (no n.stats, or stats.durationMin === null → Math.floor(null/60) === 0) → `var durH = st ? Math.floor(st.durationMin / 60) : 0;` | /home/michal/wt-absence-survey-kst/oxydex-render.js:2166 — ssKPI('Duration', durStr, durH >= 7 ? 'good' : durH >= 6 ? 'w |
| 69 | `oxydex-render.js:3315` | F1 | motion channel condemned as stuck/absent — `oxydex-dsp.js` `processNight` sets `stats.motionPct = null` deliberately, with the reason → `metric('Motion %', n.stats ? n.stats.motionPct + '%' : '—', 'of recording', n.st` | oxydex-render.js:3315 (the `metric()` card rendered into the Movement Profile `.grid`) |
| 70 | `ppgdex-app.js:1002` | F5 | no ACC/GYRO companion was loaded, so no motion gate ran; ppgdex-dsp.js:4673 still yields a number (0 when nothing was rejected bec → `motionRejectedPct: r.motionRejectedPct,` | integrator-dsp.js:370 |
| 71 | `ppgdex-dsp.js:6193` | F2 | the sample rate of a SignalFrame-routed recording that carried no fs (neither input.fs nor samples.fs) → `for (var i = 0; i < n; i++) relSec[i] = i / (fs \|\| 1);` | ppgdex-dsp.js:5713 (`recording.durSec`) and every beat time via `rec.relSec` → `footSec` (:4407) |
| 72 | `ppgdex-dsp.js:6203` | F2 | recording duration when neither a declared durSec nor a sample rate exists (and, in the last arm, when the frame carries <=1 sampl → `durSec: s.durSec != null ? s.durSec : n > 1 ? (n - 1) / (fs \|\| 1) : 0,` | ppgdex-dsp.js:5713 (`recording.durSec`, guarded only by isFinite) |
| 73 | `pulsedex-app.js:554` | F1 | no Welltory row exists for this recording's date — i.e. no reference measurement for this day → `const match = welltoryData.rows.find((r) => (r[0] \|\| '').slice(0, 10) === dateSt` | pulsedex-render.js:483 |
| 74 | `pulsedex-app.js:638` | F1 | whether the beat stream actually covers its wall-clock span — unmeasurable when the file carries no per-beat timestamps (parsed.ts → `let coverage = 100;  /* … */ coverage = wall > 0 ? +Math.min(100,(rrSum/wall)*10` | pulsedex-app.js:1025 |
| 75 | `pulsedex-app.js:788` | F2 | the user never entered an age (pxProfile absent or field blank) → `const age = _pp.age \|\| 40;  →  const tanaka = Math.round(208 - 0.7 * age);` | pulsedex-render.js:117 |
| 76 | `pulsedex-overview.js:35` | F2 | no anthropometry entered — the profile record is pristine or the input is blank → `age: n(p.age, 40), weight: n(p.weight, 78), height: n(p.height, 176)` | pulsedex-overview.js:484 (via pulsedex-app.js:788) |
| 77 | `qrs-equiv-analysis.js:302` | F1 | the PAT-jitter dispersion was NOT computed — either Bland–Altman refused for one or both pairs (fewer than 3 finite pairs, i.e. `b → `var patSD = baEP && baPP && baPP.sd > baEP.sd ? Math.sqrt(baPP.sd * baPP.sd - ba` | papers/rmssd-equivalence.html:28 (and qrs-equiv-analysis.js:387 export field patJitterSdMs) |
| 78 | `resp-acc-analysis.js` `agreementSensitivity` | F2 | proportionalBias() returned null — fewer than 3 usable epochs, or every epoch at one magnitude (sxx==0), i.e. the proportional-bia → `slope: ba.prop ? ba.prop.slope : 0` | resp-acc-analysis-app.js:618-620 (sensitivity caption, neg(s0.slope)/neg(sN.slope)) |

## 4 · Confirmed findings — MEDIUM and LOW

The remaining 212 confirmed rows (159 medium, 53 low) are in
`audits/ABSENCE-SURVEY-2026-09-22.json` with the same fields, rather than repeated here: a table of 290 rows is
not read, and the JSON is what a picker-up should filter.

## 5 · Residue-ready rows

**Not appended to `RESIDUE.md`.** 290 rows would swamp the ledger, and the owner's review of the §∅ mechanism
(all-hands 2026-09-06) decides whether these go in one by one or into the sidecar programme as a block. The
key form is `2026-09-23-absence-<file>-<line>`; the JSON carries every field a row needs. **The HIGH rows are
the ones to file first if the answer is "one by one".**

## 6 · Refuted (633) — so nobody re-finds them

Every refuted finding, with its refuting reason and the file:line the lens actually read, is in the JSON under
`refuted`. Reading that list before filing any new §∅ finding in these files is cheaper than re-deriving it.

## 7 · Done when

- [ ] Owner rules: (a) HIGH rows to `RESIDUE.md` individually, (b) F1–F5 folded into
      `SAMPLE-VALIDITY-ENVELOPE` as the sidecar programme's work list, (c) both.
- [ ] Each fix lands with a **planted control that fails on `origin/main`** before the fix is accepted.
- [ ] The five device-emitted findings are verified by hand — they are the sidecar's own population, and
      `!= sentinel` is the wrong remedy for them (§∅: key on run length, never on value membership).

## 8 · Related

`FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md` (DONE) · `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` ·
`CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md` · CLAUDE.md §∅, §🔒 §2.6/§2.7 · #2897 ·
`audits/ABSENCE-SURVEY-2026-09-22.json`.
