<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-09-22 · **Owner:** unassigned · **Relates:** CLAUDE.md §∅ · `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` · `FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md` (DONE — the JS `std`/default-KPI class; this survey is the §∅ mandate one layer wider) · #2897 (the motivating case)

# §∅ Absence survey — every place "not measured" is a number, fleet-wide, adversarially verified

> **Read §0 before quoting a number from this brief.** A "confirmed" row is a hypothesis with two independent
> adversarial readings behind it, not a measurement; the survey was cut short by the weekly token limit, so
> §1 is the verified SUBSET of what the finders reported, and §5 names the 744 findings nobody checked.

## 0 · How this was produced, and what it is not

- **Surface:** the runtime tree of `origin/main` at 2026-09-22 ~20:45 (root `*.js` + `capture-host/*.py`;
  `tests/`, `tools/` and `*_test.py` excluded) — **236 files, 164,376 lines**, read in **130 units** of
  ≤ 2,500 lines by one Opus finder each (`linesRead` summed to 164,375). Findings were CLASSED by the
  five shapes CLAUDE.md §∅ names (default-number · in-band-sentinel · aggregate-over-absence ·
  discontinuity-annotated · default-reads-as-measured), with the "do not flag" list (a genuine zero
  count; an accumulator that carries `n`; a documented refusal; a device-emitted byte stored faithfully)
  in every finder's instructions.
- **Raw yield: 923 findings** (194 high · 450 medium · 279 low; 917 path-manufactured · 5 device-emitted).
- **Verification:** each finding was to be judged by TWO independent lenses — A "is it really absence?"
  (default: refute) and B "does it reach a consumer that cannot tell?" (default: refute unless traced) —
  and kept only when NEITHER refuted. At most **5 per unit** were sent to verification (highest severity
  first), which is a known blind spot named in §5. **The run hit the account's weekly token limit at
  ~179 of ~500 pairs**: **33 confirmed · 146 refuted · 744 unverified** (the capped ones plus the ones
  the limit cut). The refutation rate on the judged population — **82 %** — is the honest calibration
  of the finders: most of what reads as a fabricated absence on one reading is a measured zero, a
  documented refusal, or a value that never reaches an output. Treat §5 accordingly.
- **What this is not:** not a measurement of prevalence (the verified set is biased toward the highest
  severities and toward whichever units the limit reached first), and not a fix. The remedy for the
  class is the sidecar / out-of-band validity mechanism pending the owner's review
  (`SAMPLE-VALIDITY-ENVELOPE-2026-09-17`); each row below is a candidate for that programme or for a
  one-PR refusal fix, per §2.
- **Provenance:** the complete finder + lens output, including every refuted and unverified finding with
  its reasons, is committed beside this brief as `audits/ABSENCE-SURVEY-2026-09-22.json` so nothing here
  has to be re-derived and nobody re-finds a refuted item.
- **Motivating case (fixed the same night, #2897):** ECGDex displayed rMSSD 10,608.5 ms on the owner's
  2026-09-21 night — the whole-record path excluded gap-straddling intervals, the per-epoch engine did
  not, and the DISPLAYED value was the epoch median. Same class, one consumer along; the fixture corpus
  could not express it. The inverse (a fabricated ABSENCE — `offered: None` over 63 real refused rows)
  was found by Wren the same day (`claude/pmdneg-offered-from-every-row-wrn`).

## 1 · Ranked confirmed findings (33) — both lenses failed to refute

| # | file:line | family | kind · origin | absence → representation | consumer (can it tell?) | sev |
|---|---|---|---|---|---|---|

| 1 | `capture-host/allan.py:655` | F4 | default-reads-as-measured · path-manufactured | a series whose identified power law falls outside [-2,+2] is NOT one of the five laws this names — i.e. the identification failed → `alpha = 2 if alpha > 2 else (-2 if alpha < -2 else alpha)` | stability() line 898 `"lag1_noise": noise_id(phase)`; the record is published beside `classification` as "a second, independent opinion" (no) | high |
| 2 | `capture-host/capture.py:10173` | F1 | default-reads-as-measured · path-manufactured | a BLE scan window that FAILED — the radio could not look, so nothing is known about any ring in that window → `except Exception as e: log.info("presence scan failed (%s) — observation unchanged", ...);` | presence_fold (capture.py:10174) → oxy_presence.observe(seen_at=None) (oxy_presence.py:118), whose docstring defines seen_at=None as "a tick (no) | high |
| 3 | `capture-host/mutation_diff.py:146` | F1 | default-reads-as-measured · path-manufactured | "the module's source could not be parsed, so WHICH functions cover the changed lines was never determined" → `except SyntaxError:         return set()` | tools/mutate_diff.py:299-302 — `stems = functions_covering(_msrc, lines)` then `if not stems: print(f"  {module}: {len(lines)} changed line( (no) | high |
| 4 | `capture-host/o2ring.py:342` | F4 | default-reads-as-measured · path-manufactured | the plaintext of a reply that could not be decrypted with the session key — the reply content was NOT recovered → `except ValueError: self.errors += 1; print(...did not decrypt...); return payload` | Cipher.unwrap -> read_reply() line 397 puts the bytes in msg["payload"]; file_list() lines 484-490 then reads count = p[0] and slices 16-byt (no) | high |
| 5 | `capture-host/oxyii.py:702` | F4 | default-reads-as-measured · path-manufactured | wear state is UNKNOWN when the sensor reports 2 (probe unplugged) or 3 (probe/sensor fault) — the ring cannot say whether the finger is in → `"worn": contact == 1,   # ONLY 1; 2 and 3 are faults, not wear` | capture.py:5108 `_set(name, worn=live["worn"], … last_error=None if live["worn"] else "no finger contact")`, and oxy_power.note_worn_rec(wor (no) | high |
| 6 | `capture-host/polar_psftp.py:736` | F1 | aggregate-over-absence · path-manufactured | files that were never enumerated because a directory listing inside the session came back TRUNCATED (recorded in `fs.truncated_dirs`, line 522) or rai → `manifest["ok"] = not got["short"]` | `capture.py:8014` `pull_polar_offline_all` returns `{"sessions":…, "ok": not short}` and `webmon.py:1688` surfaces the same manifest to the (no) | high |
| 7 | `capture-host/probe_pmd_surface.py:535` | F1 | default-reads-as-measured · path-manufactured | the BEFORE-write sample stamp was never obtained (sample_stamp returned None: device not advertising, no start command, or a 10 s frame timeout), so t → `moved = before.get("device_stamps") and after["device_stamps"][:16] != before["device_stam` | _clock_conclusion's own fall-through return at line 542 — `f"SET_LOCAL_TIME accepted; sample clock unchanged. {after['verdict']}"` — publish (no) | high |
| 8 | `capture-host/probe_verity_survey.py:335` | F1 | default-reads-as-measured · path-manufactured | the device never answered the status query (cp.send returns None on a 6 s timeout, or the notification was lost) → `after = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b"")  … got["stopped_` | got["stopped_confirmed_by_device"] (line 338), the survey's primary safety verdict, via pmd.is_recording → status.get(meas, NO_MEASUREMENT) (no) | high |
| 9 | `capture-host/probe_verity_survey.py:587` | F1 | default-reads-as-measured · path-manufactured | the unconditional safety backstop's status read timed out / returned no reply → `before = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b""); active = [m fo` | out["left_clean"] = {"was_active": [...], "still_active": [...]} (lines 592-596), the report field that asserts nothing was left recording (no) | high |
| 10 | `capture-host/sealbox.py:280` | F3 | default-reads-as-measured · path-manufactured | the night's close time when the directory yields no file mtimes (no files, or every file disappearing between the caller's count and this call) → `newest = max((os.path.getmtime(p) for _, p in _seal._night_files(night_dir)), default=time` | seal_or_reissue() line 369 passes it as closed_at_ms= into _seal.seal_night, which writes it into the sealed header; every downstream reader (no) | high |
| 11 | `cohort-worker.js:162` | F2 | default-number · path-manufactured | the night's sample interval, when durationMin was not produced by processNight → `var dt = st.durationMin && rows.length ? (st.durationMin * 60000) / rows.length : 1000;` | detTMs (line 171) -> score.nights[].detectedDesatTMs, the per-event absolute timestamps the harness scores against planted desaturation trut (no) | high |
| 12 | `cpapdex-cross.js:650` | F3 | in-band-sentinel · path-manufactured | a missing recording start stamp on the live or SD channel (buildCompareSets line 770 can produce undefined via `live.clock && live.clock.t0Ms`) → `var clockOffsetSec = ((a.t0Ms \|\| 0) - (b.t0Ms \|\| 0)) / 1000;` | compareChannel() publishes clockOffsetSec and alignmentOffsetSec, and lines 652-668 use the same coerced values to decide the overlap refusa (no) | high |
| 13 | `cpapdex-edf.js:239` | F2 | default-number · path-manufactured | one signal's samples-per-record header field unparseable/absent (blockInt → null) → `return a + (b \|\| 0);` | bytesPerRecord (line 241) → dataStart/record offsets in the decode loop (lines 279–315) → every sample value in signals[*].data (no) | high |
| 14 | `cpapdex-edf.js:263` | F2 | default-number · path-manufactured | record duration missing/unparseable in the EDF header (asciiNum → null), so the sampling rate is UNKNOWN → `fs: recDurSec ? spr / recDurSec : 0` | cpapdex-dsp.js:1019 `var fs = pressCh ? pressCh.fs : 0.5;` (mask-on detection) and :153/286 `ch.fs \|\| targetFs` / `raw.fs \|\| 1` (no) | high |
| 15 | `cpapdex-edf.js:310` | F2 | default-reads-as-measured · path-manufactured | an unparseable/absent physical or digital calibration header (asciiNum/asciiInt return null for a blank or garbage field) → `var scale = (pMax - pMin) / (dMax - dMin \|\| 1);` | signals[label].data, read by cpapdex-dsp.js:161/286/321 (resample + all pressure/flow metrics) (no) | high |
| 16 | `dex-profile.js:1010` | F4 | default-reads-as-measured · path-manufactured | elevation never entered — popDefaults() deliberately returns `elevation: null` (lines 210–218) precisely so an unmeasured altitude cannot assert sea l → `r.v > 1500 ? '⛰ ' + … : '~ sea level · adjusts above ' + toDisp('elevation', 1500) + ' ' +` | _sub() → renderPanel build(), line 1159: `html += '<div class="prof-sublabel …">' + (sub[1] \|\| '')` — the profile panel's elevation sublabel (no) | high |
| 17 | `capture-host/capture.py:607` | F2 | default-reads-as-measured · path-manufactured | the real time span covered by one raw dual-wavelength (OP_RT_PPG) buffer, which the ring never reports and the host never measures → `_RT_PPG_SPAN_S = 1.0` | capture.py:4924 `step = _RT_PPG_SPAN_S / max(len(recs) - 1, 1)` → `ppg2wr.write_ppg2w(ph, None, a, b, mo)` — the Phone-timestamp column of t (no) | medium |
| 18 | `capture-host/capture.py:3356` | F2 | default-reads-as-measured · path-manufactured | stream_fs[meas] is set only on a SUCCESSFUL negotiation; absent means the rate this stream is delivering at was never agreed (a NO_ACK-kept stream, an → `key, hz = _live_key(pmd.MEAS_NAME[meas], tag), stream_fs.get(meas) or pmd.SAMPLE_HZ.get(me` | telemetry.LiveBus.push(..., fs=hz) -> broadcast frame msg = {'stream':…, 'fs': rate, …} (telemetry.py:919) to the live monitor, and the ring (no) | medium |
| 19 | `capture-host/capture.py:3388` | F3 | in-band-sentinel · path-manufactured | the SIG Heart Rate characteristic (0x2A37) carries NO device timestamp at all — there is no device clock for this sample → `hr_writer.write_hr(_now(), 0, bpm, rr)` | writers.StreamWriter.write_hr -> self._seams.feed(phone, sensor_ns) (writers.py:952). feed() treats ONLY None as absence ('if sensor_ns is N (no) | medium |
| 20 | `capture-host/capture.py:3662` | F1 | default-number · path-manufactured | the device's rate MENU was not read — get_settings_cmd timed out, returned b'' (see _ctrl's two `return b""` paths), or parse_settings_response yielde → `pmd.MEAS_NAME.get(meas, str(meas)): settings.get(0x00) or []}})` | webmon.py:1224-1228 — `opts = status[...]['pmd_options'] or {}`; the dict is truthy (it holds the stream key mapping to []), so `dev['pmd_op (no) | medium |
| 21 | `capture-host/capture.py:9758` | F1 | default-reads-as-measured · path-manufactured | the auto-start record for THIS therapy session exists on disk but could not be read or parsed (permission error, I/O error, truncated/malformed JSON) → `return (float(session_ms) if rec.get("manual_stop") else None), int(rec.get("attempts", 0)` | _cpap_autostart_boot (capture.py:9794) builds cpap_live.StartWatch(began_at_ms, None, manual, attempts, None), consumed by cpap_live.autosta (no) | medium |
| 22 | `capture-host/capture.py:10833` | F2 | in-band-sentinel · path-manufactured | the real negotiated ATT MTU when _acquire_mtu was unavailable or raised (the except-pass at 10806-10808 leaves bleak's placeholder) → `mtu = getattr(client, "mtu_size", 23) or 23` | step = max(20, mtu - 3) at capture.py:10834, the GATT write chunk size used by write() at 10837; and the published log line "CPAP %s: link M (no) | medium |
| 23 | `capture-host/cpap_live.py:67` | F3 | default-reads-as-measured · path-manufactured | a reading whose age cannot be meaningfully computed because the host clock stepped between publish and serve — i.e. the age is unknown, not zero → `return max(0.0, age)` | live_view (same file, lines 82-92) → served by webmon.py:384 to the monitor page as {age_s, fresh}; a clamped 0.0 makes fresh = (0.0 <= limi (no) | medium |
| 24 | `capture-host/nightqc.py:713` | F1 | default-number · path-manufactured | the number of data rows in a file that could not be opened or read at all → `except OSError: return 0   # in count_rows(path)` | summarize() sums these into streams[s]; rows == 0 routes the stream into `missing` (or `optional_absent`), and a partially unreadable set un (no) | medium |
| 25 | `capture-host/nightqc.py:1676` | F4 | aggregate-over-absence · path-manufactured | rows never captured or not parsed — the epoch axis is row-count/100, so a BLE dropout or a skipped torn row (continue at the int() parse, ~line 1654) → `doff = t0 + timedelta(seconds=block["epochs"] - block["trailing_off_epochs"])` | block["doff_at"] in summary["ppg2w_contact"] — published as the ISO wall-clock instant the ring came off (no) | medium |
| 26 | `capture-host/o2ring.py:335` | F4 | default-reads-as-measured · path-manufactured | in a keyed session, a reply whose length proves it is not session-cipher output — its true plaintext is unknown → `if not payload or len(payload) % 16: return payload  # cannot be AES output — pass through` | read_reply() line 397 -> msg["payload"], consumed as plaintext by file_list/file_start/pull_session/_probe_one (no) | medium |
| 27 | `capture-host/probe_verity_survey.py:216` | F1 | in-band-sentinel · path-manufactured | a settings-menu query in the capability sweep timed out (one of 4 modes × N measurements) → `return {pmd.SETTING_NAME.get(sid, f"setting_{sid:#04x}"): vals for sid, vals in pmd.parse_` | got["capability"]["settings_menus"][name][mode] (line 288) — the survey's record of which modes the device supports and at what rates (no) | medium |
| 28 | `capture-host/sealbox.py:342` | F1 | default-reads-as-measured · path-manufactured | the previous seal's revision number when the existing header does not carry the field (or, via existing_header()'s except at line 273, when an existin → `revision = 1 if header is None else int(header.get("revision", 0)) + 1` | the value is written into the new seal header by _seal.seal_night(revision=…), echoed in result["revision"] (line 379) and passed to _unseal (no) | medium |
| 29 | `capture-host/telemetry.py:118` | F4 | default-reads-as-measured · path-manufactured | the negotiated PPG sample rate — `None` means the rate was never recorded, not that it is 55 Hz → `if fs is None:\n        return True   # calibrated_for()` | optical_worn (line 135) → worn_verdict vote "ambient-level" → capture.py:3330 `fs=stream_fs.get(pmd.PPG)` (a .get that yields None when the (no) | medium |
| 30 | `capture-host/telemetry.py:874` | F2 | default-reads-as-measured · path-manufactured | the stream's sample rate when none was passed and the declared StreamMeta.fs is 0 — and 0 is this file's own declared encoding for "irregular / per-ev → `rate = fs or (m.fs if m else 0) or 1` | the broadcast msg {"fs": rate} → webmon SSE → monitor.html:3336 `st.fs = d.fs \|\| st.fs`, then monitor.html:3479 `ibis.push((peaks[i]-peaks[i (no) | medium |
| 31 | `cpapdex-cross.js:648` | F2 | default-number · path-manufactured | the sample rate of both channels when neither EDF header supplied one (or supplied 0) → `var fs = a.fs \|\| b.fs \|\| 1;` | compareChannel(): fs converts sample counts to time for endMs, ai0/bi0, overlapN, lag = lagSamp/fs, and the published overlapMin, appliedLag (no) | medium |
| 32 | `cpapdex-edf.js:260` | F2 | default-number · path-manufactured | same absent samples-per-record header, at the buffer-allocation site → `var spr = sampPerRec[s2] \|\| 0;` | new Float32Array(spr * recordsRead) at line 262 → signals[label].data, consumed by cpapdex-dsp.js:161 (no) | medium |
| 33 | `dex-ingest.js:56` | F3 | default-reads-as-measured · path-manufactured | an out-of-range component (month 13, day 45, 25:99) means no VALID stamp was read; Date.UTC silently rolls it onto a plausible wrong instant instead o → `return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;` | _dedupeBySession line 249 builds the session signature `dk+'@'+st`, and pickNearestByStamp line 300 scores `candidates[i].stampMs` against r (no) | medium |

## 2 · Mechanism families — four shapes, one remedy each

Every confirmed row is **path-manufactured** (0 of 33 device-emitted), so in every case the fix is ours to make and the recording is not to be touched (§∅: captured bytes are immutable; correction lives beside the file).

### F1 · "COULD NOT LOOK" folded into "LOOKED AND SAW NOTHING"

A failed scan, an unanswered GATT read, an unparseable file, a truncated listing or an unreadable record returns the SAME empty value (`{}`, `set()`, `[]`, `0`, `(None, 0)`) that a genuine "observed, nothing there" returns, and the consumer folds it as an observation. Remedy: the refusal is a distinct value — `None`/a `{ok:false, reason}` object — and the fold is SKIPPED, never fed an empty observation; where a positive verdict is published (`stopped_confirmed_by_device`, `left_clean`, `manifest.ok`) it is published only over answered reads, with the unanswered count beside it.

Instances: `capture.py:10173` · `mutation_diff.py:146` · `probe_verity_survey.py:335` · `probe_verity_survey.py:587` · `probe_verity_survey.py:216` · `capture.py:3662` · `nightqc.py:713` · `capture.py:9758` · `sealbox.py:342` · `probe_pmd_surface.py:535` · `polar_psftp.py:736`

### F2 · A RATE OR GEOMETRY DEFAULTED, THEN SPENT AS A TIMEBASE

`fs || 1`, `fs: 0`, the vendor `SAMPLE_HZ` default, a 1000 ms cadence, `sampPerRec || 0`, `scale / (… || 1)`, a 1.0 s span constant, an MTU of 23 — every one is a legal value of its own quantity, so a consumer converting samples to seconds (or bytes to records) cannot tell the default from a negotiation. Remedy: an unknown rate/geometry is `null` and the node REFUSES the dependent quantity with a named reason (`rate-unknown`); a rate is never defaulted, and a default that must exist for transport (the MTU chunk) is logged as `assumed`, never published as `negotiated`.

Instances: `cpapdex-cross.js:648` · `telemetry.py:874` · `cpapdex-edf.js:263` · `capture.py:3356` · `cohort-worker.js:162` · `cpapdex-edf.js:239` · `cpapdex-edf.js:260` · `cpapdex-edf.js:310` · `capture.py:607` · `capture.py:10833`

### F3 · A CLOCK FABRICATED WHERE THE STAMP WAS ABSENT (Clock Contract §2.6/§2.7 at the box and in a node)

`time.time()` for an unobserved close instant, `t0Ms || 0` (epoch 0 is a legal floating tMs), `Date.UTC` rolling an invalid stamp onto a plausible instant, a literal `0` where every sibling passes `None` for "no device clock", a negative age clamped to the freshest possible value. Remedy is the contract as written: null, never now(); `_ckMk`-style component validation; `None` is the only absence a sidecar recognises.

Instances: `sealbox.py:280` · `cpapdex-cross.js:650` · `dex-ingest.js:56` · `capture.py:3388` · `cpap_live.py:67`

### F4 · A DEVICE FAULT OR UNCLASSIFIABLE INPUT COLLAPSED INTO A BENIGN STATE

Contact 2/3 (probe fault) → `worn: False` (a lead-off), an undecryptable reply → plaintext, an unknown PPG rate → "calibrated", a power law outside the five named → clamped to the nearest named, an unmeasured elevation → "~ sea level", a doff instant counted from rows a dropout removed. Each publishes a confident benign reading about a state the path could not classify. Remedy: a third value (`unknown`/`fault`) that the consumer must handle, and the classification refusing (`None`) rather than clamping.

Instances: `oxyii.py:702` · `o2ring.py:335` · `o2ring.py:342` · `telemetry.py:118` · `allan.py:655` · `dex-profile.js:1010` · `nightqc.py:1676`

**Where "device emitted" vs "path manufactured" changes the fix:** nowhere in this set — but §5's
unverified 744 include the 5 device-emitted findings (in-band device sentinels the consumer misreads),
and those are sidecar work (out-of-band validity), not `!= sentinel` guards, per §∅'s "key on run length,
never on value membership".

## 3 · Residue-ready rows

One row per confirmed finding, in `RESIDUE.md`'s 6-cell form, **not yet appended** — the owner's
review of the §∅ mechanism (all-hands 2026-09-06) decides whether these go to the ledger one by one or
into the sidecar programme as a block. Append, never edit, when picked up.

| key | logged | source | defect | evidence | state |
|---|---|---|---|---|---|

| 2026-09-22-absence-allan-655 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **a series whose identified power law falls outside [-2,+2] is NOT one of the five laws this names — i.e. the identificati** is represented as `alpha = 2 if alpha > 2 else (-2 if alpha < -2 else alpha)` (default-reads-as-measured) | `capture-host/allan.py:655` → stability() line 898 `"lag1_noise": noise_id(phase)`; the record is published beside `classification` as "a se; lens B: The clamp at capture-host/allan.py:655 is unguarded and its result is published unmarked as {alpha, noise, differences, | open |
| 2026-09-22-absence-capture-10173 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **a BLE scan window that FAILED — the radio could not look, so nothing is known about any ring in that window** is represented as `except Exception as e: log.info("presence scan failed (%s) — observati` (default-reads-as-measured) | `capture-host/capture.py:10173` → presence_fold (capture.py:10174) → oxy_presence.observe(seen_at=None) (oxy_presence.py:118), whose docstring d; lens B: Traced the failed-scan `seen = {}` (capture.py:10173) → presence_fold (capture.py:10148) → oxy_presence.observe(seen_at= | open |
| 2026-09-22-absence-mutation-diff-146 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **"the module's source could not be parsed, so WHICH functions cover the changed lines was never determined"** is represented as `except SyntaxError:         return set()` (default-reads-as-measured) | `capture-host/mutation_diff.py:146` → tools/mutate_diff.py:299-302 — `stems = functions_covering(_msrc, lines)` then `if not stems: print(f"  {modul; lens B: Not refuted: the empty set flows to capture-host/tools/mutate_diff.py:299-302, where `if not stems:` prints the measured | open |
| 2026-09-22-absence-o2ring-342 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the plaintext of a reply that could not be decrypted with the session key — the reply content was NOT recovered** is represented as `except ValueError: self.errors += 1; print(...did not decrypt...); ret` (default-reads-as-measured) | `capture-host/o2ring.py:342` → Cipher.unwrap -> read_reply() line 397 puts the bytes in msg["payload"]; file_list() lines 484-490 then reads; lens B: Not refuted: capture-host/o2ring.py:342 returns the undecrypted ciphertext in the plaintext slot with no flag, self.erro | open |
| 2026-09-22-absence-oxyii-702 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **wear state is UNKNOWN when the sensor reports 2 (probe unplugged) or 3 (probe/sensor fault) — the ring cannot say whethe** is represented as `"worn": contact == 1,   # ONLY 1; 2 and 3 are faults, not wear` (default-reads-as-measured) | `capture-host/oxyii.py:702` → capture.py:5108 `_set(name, worn=live["worn"], … last_error=None if live["worn"] else "no finger contact")`, a; lens B: Traced and NOT refuted for the runtime consumers: `worn` from oxyii.py:702 is published unqualified at capture-host/capt | open |
| 2026-09-22-absence-polar-psftp-736 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **files that were never enumerated because a directory listing inside the session came back TRUNCATED (recorded in `fs.tru** is represented as `manifest["ok"] = not got["short"]` (aggregate-over-absence) | `capture-host/polar_psftp.py:736` → `capture.py:8014` `pull_polar_offline_all` returns `{"sessions":…, "ok": not short}` and `webmon.py:1688` surf; lens B: `truncated_dirs` is written at polar_psftp.py:522 and read by nothing outside tests (only capture-host/tests/test_polar_ | open |
| 2026-09-22-absence-probe-pmd-surface-535 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the BEFORE-write sample stamp was never obtained (sample_stamp returned None: device not advertising, no start command,** is represented as `moved = before.get("device_stamps") and after["device_stamps"][:16] !=` (default-reads-as-measured) | `capture-host/probe_pmd_surface.py:535` → _clock_conclusion's own fall-through return at line 542 — `f"SET_LOCAL_TIME accepted; sample clock unchanged.; lens B: Not refuted on the logic: probe_pmd_surface.py:535's `and` short-circuits when the before-observation's stamp is None (s | open |
| 2026-09-22-absence-probe-verity-survey-335 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the device never answered the status query (cp.send returns None on a 6 s timeout, or the notification was lost)** is represented as `after = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or b` (default-reads-as-measured) | `capture-host/probe_verity_survey.py:335` → got["stopped_confirmed_by_device"] (line 338), the survey's primary safety verdict, via pmd.is_recording → sta; lens B: Confirmed reachable: `send()` returns None on a GATT refusal or 6 s timeout (capture-host/probe_pmd_surface.py:220,243), | open |
| 2026-09-22-absence-probe-verity-survey-587 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the unconditional safety backstop's status read timed out / returned no reply** is represented as `before = pmd.parse_status_response(await cp.send(pmd.status_cmd()) or` (default-reads-as-measured) | `capture-host/probe_verity_survey.py:587` → out["left_clean"] = {"was_active": [...], "still_active": [...]} (lines 592-596), the report field that assert; lens B: Not refuted: `Control.send` returns None on notify timeout (probe_verity_survey.py:118-124), `parse_status_response(b"") | open |
| 2026-09-22-absence-sealbox-280 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the night's close time when the directory yields no file mtimes (no files, or every file disappearing between the caller** is represented as `newest = max((os.path.getmtime(p) for _, p in _seal._night_files(night` (default-reads-as-measured) | `capture-host/sealbox.py:280` → seal_or_reissue() line 369 passes it as closed_at_ms= into _seal.seal_night, which writes it into the sealed h; lens B: Not refuted: the value flows sealbox.py:280 → seal_or_reissue closed_at_ms= (sealbox.py:369) → seal.py:267 `"closedAt": | open |
| 2026-09-22-absence-cohort-worker-162 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the night's sample interval, when durationMin was not produced by processNight** is represented as `var dt = st.durationMin && rows.length ? (st.durationMin * 60000) / ro` (default-number) | `cohort-worker.js:162` → detTMs (line 171) -> score.nights[].detectedDesatTMs, the per-event absolute timestamps the harness scores aga; lens B: Not refuted: the 1000 ms fallback at cohort-worker.js:162 is live (oxydex-dsp.js:3142 nulls durationMin whenever _durBad | open |
| 2026-09-22-absence-cpapdex-cross-650 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **a missing recording start stamp on the live or SD channel (buildCompareSets line 770 can produce undefined via `live.clo** is represented as `var clockOffsetSec = ((a.t0Ms \|\| 0) - (b.t0Ms \|\| 0)) / 1000;` (in-band-sentinel) | `cpapdex-cross.js:650` → compareChannel() publishes clockOffsetSec and alignmentOffsetSec, and lines 652-668 use the same coerced value; lens B: Not refuted: parseEdfClock returns null on an unparseable EDF header stamp (cpapdex-edf.js:59,70,73), readEDF passes clo | open |
| 2026-09-22-absence-cpapdex-edf-239 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **one signal's samples-per-record header field unparseable/absent (blockInt → null)** is represented as `return a + (b \|\| 0);` (default-number) | `cpapdex-edf.js:239` → bytesPerRecord (line 241) → dataStart/record offsets in the decode loop (lines 279–315) → every sample value i; lens B: Confirmed unguarded: `asciiInt` returns null on an unparseable ns-samples field (cpapdex-edf.js:39-43), and line 239's ` | open |
| 2026-09-22-absence-cpapdex-edf-263 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **record duration missing/unparseable in the EDF header (asciiNum → null), so the sampling rate is UNKNOWN** is represented as `fs: recDurSec ? spr / recDurSec : 0` (default-number) | `cpapdex-edf.js:263` → cpapdex-dsp.js:1019 `var fs = pressCh ? pressCh.fs : 0.5;` (mask-on detection) and :153/286 `ch.fs \|\| targetFs; lens B: cpapdex-edf.js:263 turns an unknown record duration (asciiNum → null at :192, unvalidated — only ns throws at :195) into | open |
| 2026-09-22-absence-cpapdex-edf-310 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **an unparseable/absent physical or digital calibration header (asciiNum/asciiInt return null for a blank or garbage field** is represented as `var scale = (pMax - pMin) / (dMax - dMin \|\| 1);` (default-reads-as-measured) | `cpapdex-edf.js:310` → signals[label].data, read by cpapdex-dsp.js:161/286/321 (resample + all pressure/flow metrics); lens B: Not refuted — I traced it to a publishing consumer with no validity flag anywhere on the path. `physMin/physMax` come fr | open |
| 2026-09-22-absence-dex-profile-1010 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **elevation never entered — popDefaults() deliberately returns `elevation: null` (lines 210–218) precisely so an unmeasure** is represented as `r.v > 1500 ? '⛰ ' + … : '~ sea level · adjusts above ' + toDisp('eleva` (default-reads-as-measured) | `dex-profile.js:1010` → _sub() → renderPanel build(), line 1159: `html += '<div class="prof-sublabel …">' + (sub[1] \|\| '')` — the prof; lens B: Traced: resolve('elevation') returns {v:null, origin:'none'} (dex-profile.js:487-501, default null at :218); _sub's elev | open |
| 2026-09-22-absence-capture-607 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the real time span covered by one raw dual-wavelength (OP_RT_PPG) buffer, which the ring never reports and the host neve** is represented as `_RT_PPG_SPAN_S = 1.0` (default-reads-as-measured) | `capture-host/capture.py:607` → capture.py:4924 `step = _RT_PPG_SPAN_S / max(len(recs) - 1, 1)` → `ppg2wr.write_ppg2w(ph, None, a, b, mo)` — t; lens B: The value does reach an unguarded consumer. `capture.py:4924` spreads each OP_RT_PPG buffer over the hardcoded `_RT_PPG_ | open |
| 2026-09-22-absence-capture-3356 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **stream_fs[meas] is set only on a SUCCESSFUL negotiation; absent means the rate this stream is delivering at was never ag** is represented as `key, hz = _live_key(pmd.MEAS_NAME[meas], tag), stream_fs.get(meas) or` (default-reads-as-measured) | `capture-host/capture.py:3356` → telemetry.LiveBus.push(..., fs=hz) -> broadcast frame msg = {'stream':…, 'fs': rate, …} (telemetry.py:919) to; lens B: Traced capture.py:3356 forward: stream_fs is set only under `if pmd_started` (capture.py:3715-3716), while the NO_ACK br | open |
| 2026-09-22-absence-capture-3388 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the SIG Heart Rate characteristic (0x2A37) carries NO device timestamp at all — there is no device clock for this sample** is represented as `hr_writer.write_hr(_now(), 0, bpm, rr)` (in-band-sentinel) | `capture-host/capture.py:3388` → writers.StreamWriter.write_hr -> self._seams.feed(phone, sensor_ns) (writers.py:952). feed() treats ONLY None; lens B: Confirmed by execution, not just reading: capture.py:3388 passes literal 0 where every no-device-clock sibling passes No | open |
| 2026-09-22-absence-capture-3662 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the device's rate MENU was not read — get_settings_cmd timed out, returned b'' (see _ctrl's two `return b""` paths), or** is represented as `pmd.MEAS_NAME.get(meas, str(meas)): settings.get(0x00) or []}})` (default-number) | `capture-host/capture.py:3662` → webmon.py:1224-1228 — `opts = status[...]['pmd_options'] or {}`; the dict is truthy (it holds the stream key m; lens B: The `_set(... "pmd_options": ... settings.get(0x00) or [])` at capture.py:3660-3662 is outside the `if settings:` guard | open |
| 2026-09-22-absence-capture-9758 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the auto-start record for THIS therapy session exists on disk but could not be read or parsed (permission error, I/O err** is represented as `return (float(session_ms) if rec.get("manual_stop") else None), int(re` (default-reads-as-measured) | `capture-host/capture.py:9758` → _cpap_autostart_boot (capture.py:9794) builds cpap_live.StartWatch(began_at_ms, None, manual, attempts, None),; lens B: Traced `_cpap_autostart_load`'s `(None, 0)` (capture.py:9758-9760) through its only caller `_cpap_autostart_boot` (captu | open |
| 2026-09-22-absence-capture-10833 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the real negotiated ATT MTU when _acquire_mtu was unavailable or raised (the except-pass at 10806-10808 leaves bleak's p** is represented as `mtu = getattr(client, "mtu_size", 23) or 23` (in-band-sentinel) | `capture-host/capture.py:10833` → step = max(20, mtu - 3) at capture.py:10834, the GATT write chunk size used by write() at 10837; and the publi; lens B: Traced `mtu` forward: only two uses exist repo-wide (grep finds nothing outside capture.py:10833-10835). The chunking ar | open |
| 2026-09-22-absence-cpap-live-67 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **a reading whose age cannot be meaningfully computed because the host clock stepped between publish and serve — i.e. the** is represented as `return max(0.0, age)` (default-reads-as-measured) | `capture-host/cpap_live.py:67` → live_view (same file, lines 82-92) → served by webmon.py:384 to the monitor page as {age_s, fresh}; a clamped; lens B: Traced cpap_live.py:67 forward: the clamped 0.0 flows into live_view (cpap_live.py:82-92) where it sets fresh=True and p | open |
| 2026-09-22-absence-nightqc-713 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the number of data rows in a file that could not be opened or read at all** is represented as `except OSError: return 0   # in count_rows(path)` (default-number) | `capture-host/nightqc.py:713` → summarize() sums these into streams[s]; rows == 0 routes the stream into `missing` (or `optional_absent`), and; lens B: Not refuted: `count_rows`'s `except OSError: return 0` (capture-host/nightqc.py:712-713) feeds `scan_night`'s per-file ` | open |
| 2026-09-22-absence-nightqc-1676 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **rows never captured or not parsed — the epoch axis is row-count/100, so a BLE dropout or a skipped torn row (continue at** is represented as `doff = t0 + timedelta(seconds=block["epochs"] - block["trailing_off_ep` (aggregate-over-absence) | `capture-host/nightqc.py:1676` → block["doff_at"] in summary["ppg2w_contact"] — published as the ISO wall-clock instant the ring came off; lens B: Mechanism confirmed: `ppg2w_contact_quality` reads `parts[0]` only once (`if first_ts is None`, nightqc.py:1657) and ski | open |
| 2026-09-22-absence-o2ring-335 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **in a keyed session, a reply whose length proves it is not session-cipher output — its true plaintext is unknown** is represented as `if not payload or len(payload) % 16: return payload  # cannot be AES o` (default-reads-as-measured) | `capture-host/o2ring.py:335` → read_reply() line 397 -> msg["payload"], consumed as plaintext by file_list/file_start/pull_session/_probe_one; lens B: The pass-through at capture-host/o2ring.py:335 is silent — no print and no errors++ (unlike the ValueError branch at :33 | open |
| 2026-09-22-absence-probe-verity-survey-216 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **a settings-menu query in the capability sweep timed out (one of 4 modes × N measurements)** is represented as `return {pmd.SETTING_NAME.get(sid, f"setting_{sid:#04x}"): vals for sid` (in-band-sentinel) | `capture-host/probe_verity_survey.py:216` → got["capability"]["settings_menus"][name][mode] (line 288) — the survey's record of which modes the device sup; lens B: Control.send returns None on timeout (probe_verity_survey.py:125-127) and _settings() collapses it to {} via parse_setti | open |
| 2026-09-22-absence-sealbox-342 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the previous seal's revision number when the existing header does not carry the field (or, via existing_header()'s excep** is represented as `revision = 1 if header is None else int(header.get("revision", 0)) + 1` (default-reads-as-measured) | `capture-host/sealbox.py:342` → the value is written into the new seal header by _seal.seal_night(revision=…), echoed in result["revision"] (l; lens B: Could not refute: the value is published and consumed. `existing_header` (sealbox.py:271-274) swallows any read error an | open |
| 2026-09-22-absence-telemetry-118 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the negotiated PPG sample rate — `None` means the rate was never recorded, not that it is 55 Hz** is represented as `if fs is None:\n        return True   # calibrated_for()` (default-reads-as-measured) | `capture-host/telemetry.py:118` → optical_worn (line 135) → worn_verdict vote "ambient-level" → capture.py:3330 `fs=stream_fs.get(pmd.PPG)` (a .; lens B: Traced `calibrated_for(None) → True` (telemetry.py:117) forward: telemetry.py:554 admits the 55 Hz-calibrated ambient th | open |
| 2026-09-22-absence-telemetry-874 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the stream's sample rate when none was passed and the declared StreamMeta.fs is 0 — and 0 is this file's own declared en** is represented as `rate = fs or (m.fs if m else 0) or 1` (default-reads-as-measured) | `capture-host/telemetry.py:874` → the broadcast msg {"fs": rate} → webmon SSE → monitor.html:3336 `st.fs = d.fs \|\| st.fs`, then monitor.html:347; lens B: Confirmed the fabrication reaches an unguarded consumer: telemetry.py:874/919 puts fs=1 on the wire for streams declared | open |
| 2026-09-22-absence-cpapdex-cross-648 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **the sample rate of both channels when neither EDF header supplied one (or supplied 0)** is represented as `var fs = a.fs \|\| b.fs \|\| 1;` (default-number) | `cpapdex-cross.js:648` → compareChannel(): fs converts sample counts to time for endMs, ai0/bi0, overlapN, lag = lagSamp/fs, and the pu; lens B: Could not refute: `fs` occurs only at cpapdex-cross.js:648 — no validation, no a.fs≠b.fs check, and the returned object | open |
| 2026-09-22-absence-cpapdex-edf-260 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **same absent samples-per-record header, at the buffer-allocation site** is represented as `var spr = sampPerRec[s2] \|\| 0;` (default-number) | `cpapdex-edf.js:260` → new Float32Array(spr * recordsRead) at line 262 → signals[label].data, consumed by cpapdex-dsp.js:161; lens B: Not refuted: `asciiInt` returns null for an unreadable samples-per-record field, so `spr = sampPerRec[s2] \|\| 0` (cpapdex | open |
| 2026-09-22-absence-dex-ingest-56 | 2026-09-22 | `ABSENCE-SURVEY-2026-09-22-BRIEF.md` | **an out-of-range component (month 13, day 45, 25:99) means no VALID stamp was read; Date.UTC silently rolls it onto a pla** is represented as `return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : nu` (default-reads-as-measured) | `dex-ingest.js:56` → _dedupeBySession line 249 builds the session signature `dk+'@'+st`, and pickNearestByStamp line 300 scores `ca; lens B: Traced and could not refute: `stampMs` (dex-ingest.js:56) feeds `_dedupeBySession` at dex-ingest.js:250, whose signature | open |

## 4 · Refuted (146) — so nobody re-finds them

Each was reported by a finder and refuted by at least one lens; the refuting reason is the useful part.

| file:line | claimed | refuted because |
|---|---|---|

| `analysis-stats.js:111` | var varB = Math.max(0, (msb - msw) / n0), varW = Math.max(0, msw); | At `analysis-stats.js:111` the value is not a stand-in for an unmeasured quantity: every group was observed and the returned object carries the full ANOVA state alongside the clamp |
| `analysis-stats.js:287` | var rAB = rho.ab \|\| 0, rAC = rho.ac \|\| 0, rBC = rho.bc \|\| 0; | `rho` is a caller-supplied model parameter, not a measurement: ρ=0 is the classic three-cornered hat, implemented one function up as `threeCorneredHat` (analysis-stats.js:151) and |
| `analysis-stats.js:508` | out[kn] = a.length >= 20 ? { lo: q(a, 0.025), hi: q(a, 0.975) } : null | analysis-stats.js:508 emits `null` when fewer than 20 bootstrap replicates survive — a documented refusal, not a fabricated value; line 498 excludes only replicates where the hat h |
| `analysis-stats.js:564` | if (sw <= 0) return 0; | The claimed harm does not occur: `_wvar`'s 0 is consumed only by `threeCorneredHat` (analysis-stats.js:151-153) whose result is gated at analysis-stats.js:618-622 by `cv.x > 0 ? sq |
| `analysis-stats.js:608` | var h = cH ? cH[i] : 1, v = cV ? cV[i] : 1, o = cO ? cO[i] : 1, | The `cH ? cH[i] : 1` guard at analysis-stats.js:608 is a whole-array fallback that is documented at analysis-stats.js:551 ("missing confidences default to 1 ⇒ this reduces to (near |
| `capture-host/alerts.py:79` | except ValueError:            # never produced by a validated value, b | The claim's core assertion — that the monitor cannot distinguish "not configured" from "configured but unparseable" — is false: webmon.py:1474-1477 returns configured: bool(url) al |
| `capture-host/alerts.py:130` | async def send(self, title, message, *, key=None, dedupe_sec: float = | The dedupe path that would consume `now` is gated by `if key is not None and dedupe_sec > 0` (alerts.py:134), and `dedupe_sec` defaults to 0.0 — a documented off-switch — so the de |
| `capture-host/alerts.py:285` | def ring_barren_connects(n, threshold=RING_BARREN_ALERT_N, *, storm_ag | The only caller computes a real count over an observed window — capture.py:5540-5543 passes `len([t for t in (_OXYII_RESTARTS.get(addr) or []) if _mono - t <= _OXYII_STORM_MEMORY_S |
| `capture-host/allan.py:622` | if den <= 0:\n        return 0.0   # _lag1_acf, docstring: "0 when the | The fabricated 0.0 (allan.py:622) does reach stability()["lag1_noise"] (allan.py:898) and into the night summary via nightqc.py:1441/2597, but a repo-wide grep finds zero readers o |
| `capture-host/allan.py:792` | md = mdev(phase, tau0)   # inside identify(), while adev_points arrive | The value reaches a consumer (allan.py:792 -> identify/stability lines 908-909 -> nightqc.py:1443,1475 night-QC record), but the asserted defect is measured false in-repo: tests/te |
| `capture-host/allan.py:877` | "span_s": (len(phase) - 1) * tau0,   with "n": len(phase) on line 876 | Not a fabricated absence: `n: len(phase)` is a faithful count of the input series handed to `stability()` and `span_s` is that series' nominal span under the `tau0` the caller expl |
| `capture-host/allan.py:905` | "mtie": _mtie_summary(mtie(phase, tau0)), | Refuted: `mtie()` (allan.py:394-438) computes a peak over `_clean(phase)` — only real finite observed samples, with per-point `n` (437), returning `[]` rather than a fabricated poi |
| `capture-host/ble_sniff.py:179` | followed = sum(1 for _, advertiser in connects if advertiser == want) | The `if want else 0` guard is not a stand-in for an unevaluated predicate: with `want is None` the ungarded expression `sum(1 for _, advertiser in connects if advertiser == want)` |
| `capture-host/ble_sniff.py:192` | "follow_adv_packets": advertisers.get(want, 0) if want else 0, | At ble_sniff.py:192 the value is a genuine counter lookup over the observed packet population when a MAC is requested (advertisers accumulated at :176-177), and when none is reques |
| `capture-host/ble_sniff.py:398` | "ok": not problems, | At ble_sniff.py:388-399 absence is already represented as null, exactly per §∅: `cover = (span / expect_s) if (expect_s and span is not None) else None` and `window`/`expect_s` sta |
| `capture-host/capture.py:1744` | rate = max(0, hist[-1][1] - hist[0][1]) / span_h | `rate` is a genuine measurement, not a stand-in for absence: the window requires ≥2 real sightings and `span_h > 0` (capture.py:1739-1743), and a 0 delta means the reconnect counte |
| `capture-host/capture.py:3247` | clock_skew_n=(0 if _est is None else _est["n"]) | `clock_skew_n` is defined as the count the estimate was computed over (`_est["n"] = len(fresh)` at capture.py:2548), not "frames seen", so when `clock_skew_estimate` refuses there |
| `capture-host/capture.py:5622` | "pct": (100 * off // size) if size else 0 | `_prog` (capture.py:5620-5622) is passed only to `pull_session.pull` (capture.py:5644), and its sole invocation is `on_progress(off, size)` inside `while off < size:` (pull_session |
| `capture-host/capture.py:5670` | except OSError: pass  # …  pw.attempt_finished(…, files=len(saved), by | capture.py:5664-5671 is an accumulator over an enumerated, observed population — `_nbytes` starts at 0 and sums `os.path.getsize` over exactly the files in `saved`, with the count |
| `capture-host/capture.py:6336` | rows.append({… "mac": (ADAPTER or "").upper(), "pinned": True, "up": p | probe_ms is written to ADAPTERHCI.csv (capture.py:6336 → adapter_hci.py:66-70) and parsed back (adapter_hci.py:81), but the sole consumer of those rows, adapter_hci.verdict_object |
| `capture-host/capture.py:6498` | if radio_looks_deaf(max(n_seen, 0), connected_any, silent, int(wcfg.ge | The -1 tri-state is preserved exactly where it is load-bearing: at capture.py:6492-6497 a failed probe matches neither `n_seen == 0` nor `n_seen > 0`, so `silent` — the only variab |
| `capture-host/capture.py:6516` | age_s = None if last_ms is None else max(0.0, _time.time() - last_ms / | Both operands are real measurements from the same host clock (`capture.py:9523` writes `last_seen_ms = _time.time()*1000.0` only on a poll that ran and answered; `capture.py:6516` |
| `capture-host/capture.py:7757` | dc = (obj.get("result") or {}).get("daemon_caused_min") or 0 | At capture.py:7757-7760 the `or 0` value is consumed only by `if dc:` on the very next line and by a `%.0f` inside that branch, so the fabricated 0 is unreachable by any surface: ` |
| `capture-host/capture.py:7766` | newest = 0.0   (… except OSError: continue …)   return newest | capture.py:7766 `newest = 0.0` is the identity element of a `max()` over an enumerated directory listing (7767-7771), not a default standing in for an unmeasured quantity; the comm |
| `capture-host/capture.py:10043` | return "UNKNOWN"   (also line 10047 and 10049's `else "UNKNOWN"`) | At capture-host/capture.py:10011-10049 `resolve_cpap_serial` returns the literal string "UNKNOWN", an OUT-OF-BAND marker no real AS11 serial can collide with (real: `SRN=2322159054 |
| `capture-host/cpap_edf.py:143` | n_records, record_duration = read_span(raw)  ...  for r in range(n_rec | The -1 is preserved verbatim (cpap_edf.py:120,154,177), never replaced by a fabricated number — samples return [] rather than zeros. The only production consumer guards it: capture |
| `capture-host/cpap_edf.py:307` | values += [fill] * (spr - rem)   # _pad_records(values, spr, fill=0.0) | The pad zeroes BOTH channels, and cpapdex's mask gate is defined as exactly that channel: with no PLD, pressCh falls back to the decimated BRP Press lane (cpapdex-dsp.js:1013-1016) |
| `capture-host/cpap_edf.py:338` | vals = list(channels.get(spec[0], [])); vals += [0.0] * (total - len(v | `build_pld` (capture-host/cpap_edf.py:327) has zero production callers: every reference in the worktree is a test (capture-host/tests/test_cpap_edf.py:79,92,222,280,287) or the unw |
| `capture-host/cpap_harvest.py:84` | digits = "".join(c for c in (s or "") if c.isdigit() or c == ".") | `size_kb`'s `return 0.0` (capture-host/cpap_harvest.py:84) is a defensive refusal path, not a published value: the `_ROW` regex at :50-53 only emits non-dir rows whose size matched |
| `capture-host/cpap_harvest.py:209` | if want <= 0:         return False | `should_fetch` (cpap_harvest.py:200-212) returns a control boolean, not a surfaced value — no number stands in for the absent size — and the `want <= 0` branch is a documented, tes |
| `capture-host/cpap_harvest.py:235` | want = size_kb(entry.get("size", ""))     if want <= 0:         return | Line 235's `return False` is the negative arm of a truncation DETECTOR, not a stored measurement, and the "no parsable size" state the claim posits is unreachable from the real pro |
| `capture-host/cpap_harvest.py:361` | return body, int(r.headers.get("Content-Length") or 0) | The `or 0` value from cpap_harvest.py:361 escapes only via `_get(want_length=True)`, whose sole non-test caller is fetch at :406; its two uses are `short_read(..., declared)` — whe |
| `capture-host/cpap_harvest.py:855` | if guard_dev is None:         return True | Absence is already carried as `None` at cpap_harvest.py:418-427 (documented `except Exception: return None — never let a probe kill the task`), so no number/sentinel/default stands |
| `capture-host/cpap_live.py:213` | rows.append((ms, parts[8].strip())) | Line 213 stores the journal's 9th column verbatim — it fabricates nothing. The absence marker is deliberately out-of-band upstream: `cpap_shadow_runner.py:200-215` (`UnreachableRow |
| `capture-host/cpap_live.py:446` | except (TypeError, ValueError):\n        nxt = None | In the sole wiring (capture-host/capture.py:9878-9894) `note_start_failed(watch, t)` is reachable only after `autostart_due(watch, t, ...)` returned due=True with the SAME `t`, whi |
| `capture-host/cpap_live.py:490` | began = rows[-1][0]  … for ms, fg in reversed(rows): if fg != "Therapy | `began` is never a default, zero or sentinel — it is always the timestamp of a real journal row that was actually read (`cpap_live.py:490-494`), and the file's own idiom is that an |
| `capture-host/cpap_stream.py:99` | self._fs = 25.0   # (kept when open() gets a non-positive/non-numeric | Refuted: 25.0 is not a stand-in for an unmeasured rate — it is the AS11 BRP protocol's own documented cadence (cpap_stream.py:29-31, 40 ms → 25 Hz), and the sink is only ever reach |
| `capture-host/cpap_stream.py:166` | fs = 1000.0 / requested_ms  # then bus.register(key, label, unit, fs, | Not absence: `requested_ms` is a genuine known configuration parameter (the interval we commanded via `sample_interval_ms`, cpap_stream.py:129/165), not a stand-in for an unmeasure |
| `capture-host/cpap_stream.py:199` | max((len(v) for v in (batch.get("channels") or {}).values() if isinsta | Only FrameKind.OK batches reach note_frame — cpap_ingest.py:67-70 rejects any StreamData whose `data` is absent/empty/non-list as MALFORMED (as11_pull.py:193-196), and as11_pull.py |
| `capture-host/mutation_diff.py:81` | return mangled[2:] if mangled.startswith("x_") and len(mangled) > 2 el | `source_function_of_glob` is typed `-> str` over Python identifiers, and `""` is not a legal identifier — so it is an out-of-band refusal marker, not an in-band sentinel inside the |
| `capture-host/mutation_diff.py:112` | except SyntaxError:         return "" | The claimed consumer misbranch is structurally unreachable: the same `_msrc` is fed to `functions_covering(_msrc, lines)` at capture-host/tools/mutate_diff.py:299, which also retur |
| `capture-host/mutation_diff.py:423` | est = prework_estimate(clean_sec, trace_factor)     if est <= left_sec | The `0.0` at tools/mutate_diff.py:311 is reached only when `mut.tests_for(module)` returned an empty selection, and with no test files there genuinely is no clean run to time — the |
| `capture-host/mutation_diff.py:993` | for line in (results_text or "").splitlines(): | `split_results` is a pure parser over `mutmut results` stdout, which is always a real `str` (capture-host/tools/mutate.py:495 sets `"results": res.stdout` with text=True, never Non |
| `capture-host/nightqc.py:661` | return {"negotiated_hz": None, "offered_hz": None, "negotiated_starts" | Traced nightqc.py:661 → rate_reality row (nightqc.py:648) → summarize "rates" (nightqc.py:2613) → QC-SUMMARY.json/status.json; no consumer reads it — repo-wide grep for negotiated_ |
| `capture-host/nightqc.py:1257` | "period_ms": round(best_s, 3),   # best_s seeded to `lo` (2.0) at line | The `best_s = lo` seed is a mypy-driven initializer, not an absence default: the update test is strict (`r > best_r` with `best_r = 0.0`, nightqc.py:1242-1254), and `r` is `abs()` |
| `capture-host/nightqc.py:2647` | checked = sum(len(d.get("streams") or []) for d in devices if not d.ge | `checked` at nightqc.py:2647 is an exact count of a declared population, not a stand-in for an unmeasured quantity — the docstring two lines above (nightqc.py:2643-2644, "Populatio |
| `capture-host/nightqc.py:2647` | checked = sum(len(d.get("streams") or []) for d in devices if not d.ge | `checked` at nightqc.py:2647 is an exact count of a declared population, not a stand-in for an unmeasured quantity — the docstring two lines above (nightqc.py:2643-2644, "Populatio |
| `capture-host/nightqc.py:2651` | "missing": list(summary.get("missing") or []), "degraded": list(summar | summarize() unconditionally emits missing/degraded/gaps_in_night as lists (nightqc.py:2547-2553) and is the only producer feeding qc_verdict (nightqc.py:2758), so the `or []` is ty |
| `capture-host/nightqc.py:2702` | got: dict = raw if isinstance(raw, dict) else {} | The sole producer of these blocks, `class_b_runs`, always emits a `clips` key — `{}` only on the held path (capture-host/nightqc.py:2099) and a measured per-channel count otherwise |
| `capture-host/nightqc.py:2704` | h = b.get("held") is not None | Every block in `summary["class_b"]` comes from `class_b_runs`, which returns `{"stream":…, "held": held_dict}` (nightqc.py:2099) or `{"stream":…, "held": None}` (nightqc.py:2116) — |
| `capture-host/nightqc.py:2844` | cols = [int(float(parts[i])) for i, _ in columns]  … except ValueError | No value is fabricated at nightqc.py:2844 — the `except ValueError: continue` drops the row and appends nothing (no 0, no default), so every sample in `chans` is a device byte stor |
| `capture-host/o2ring.py:489` | sid = slot[:14].split(b"\x00")[0].decode("ascii", "replace") | o2ring.py:461-490 is the standalone USB debug CLI (no importers outside capture-host/tests/); the production BLE path calls the guarded twin oxyii.py:345 parse_file_list, which dro |
| `capture-host/o2ring.py:562` | return data | The completeness flag is not lost: o2ring.py:560 derives `complete` purely from `data` (trailer magic), and parse_dat.py:56/70 recompute the same check, so a truncated .dat publish |
| `capture-host/o2ring.py:701` | p = msg["payload"] if msg else b"" | Traced `p` forward: it is local to the `if a.cmd == "info"` branch of `main()` (/home/michal/wt-absence-survey-kst/capture-host/o2ring.py:698-707), read only by the `print` at :702 |
| `capture-host/oxy_power.py:535` | def attempt_finished(self, now, *, ok, failure=None, files: int = 0, b | Traced capture.py:5664-5671 → oxy_power.py:541/554 (counters.bytes, only on ok=True) → snapshot() oxy_power.py:646-651 → capture.py:4300 STATUS["power"] → webmon.py:462, and the ch |
| `capture-host/oxy_power.py:539` | prev = self._open_attempt or Attempt(started=now, ended=None, trigger= | The claim's core assertion is false on the code: oxy_power.py:540 builds the closed record with `trigger=prev.trigger`, so the placeholder's sentinel `trigger="?"` is NOT discarded |
| `capture-host/oxy_power.py:552` | self.counters.harvest_seconds += a.duration_s or 0.0 | At oxy_power.py:540 the attempt `a` is constructed with `ended=now` (a required non-optional float param of `attempt_finished`, line 534), so `Attempt.duration_s` (lines 283-285: ` |
| `capture-host/oxy_power.py:644` | "scan_policy": scan_policy_for(self.state).name, | oxy_power.py:145-151 declares `sync_expected` as a keyword-only escalation override whose docstring states the policy is chosen "from the ring's power state alone", and tests/test_ |
| `capture-host/oxy_transfer.py:416` | attempt = (row.get("attempt") or 0) + 1 | `oxy_transfer.select()` (the function containing line 416) has zero production callers — the only references are in capture-host/tests/test_oxy_transfer.py (:158, :205, :259, :869) |
| `capture-host/oxy_transfer.py:431` | have = row.get("size") or 0 | `select()` (oxy_transfer.py:373), which contains the `have = row.get("size") or 0` at line 431, has zero production callers — every call site is in capture-host/tests/test_oxy_tran |
| `capture-host/oxy_transfer.py:478` | return DownloadResult(written, False, FailureClass.STORAGE_FAILURE, f" | At `capture-host/oxy_transfer.py:456-478`, `written` is a per-call write accumulator published only alongside `complete=False` and a named `FailureClass.STORAGE_FAILURE` plus a rea |
| `capture-host/oxy_transfer.py:486` | return DownloadResult(written, True, None, f"{written} B received") | `DownloadResult.complete` is not a claim about recording completeness — it is the observed outcome of the transfer step itself: the `fetch()` generator terminated normally, the wri |
| `capture-host/oxy_transfer.py:507` | return VerifyResult(False, VALIDATION_DEPTH, f"unreadable: {exc}", 0, | Traced `VerifyResult.size` forward: the only production caller of `oxy_transfer.verify` is `capture-host/pull_session.py:409-416`, which reads `vr.ok` and `vr.reason` only and disc |
| `capture-host/oxyii.py:599` | if not parsed:         return False  # a short/undecodable frame is de | REFUTED. `frame_looks_like_ciphertext` returns a *suspicion predicate*, not a measurement, and the `False` at oxyii.py:599 is a documented delegation ("decode()'s business, not thi |
| `capture-host/oxyii.py:686` | "pi":   payload[7] / 10.0,                     # perfusion index, % | At the cited line (oxyii.py:686) `pi` is `payload[7] / 10.0` — a faithful, unit-scaled pass-through of a device-emitted byte, with no default, no `?? 0`, no fill and no sentinel in |
| `capture-host/oxyii.py:1211` | "avg_spo2": t[34], "min_spo2": t[35], … "avg_hr": t[47], | `parse_oxy_trailer` (oxyii.py:1203-1227) is a pure byte-faithful reader of the device's own 48-byte Format-A trailer — CLAUDE.md §∅ expressly rules that device-emitted bytes stored |
| `capture-host/oxyii.py:1215` | "start_t_ms": int.from_bytes(t[8:12], "little") * 1000,   # FLOATING w | The value is published only into the `.dat.meta.json` sidecar (`pull_session.py:493/506/531`) and has zero readers: a whole-worktree grep for `start_t_ms` hits only the producer `o |
| `capture-host/polar_pmd.py:132` | if not value:         return set() | The "no answer" case never reaches `parse_features`: a lost/failed control-point READ raises from `read_gatt_char`, and every call site handles it on a distinct path — capture.py:3 |
| `capture-host/polar_pmd.py:431` | return SAMPLE_HZ.get(meas, 0) | The only reachable `0` is PPI, whose `SAMPLE_HZ` entry is a documented "not rate-based" marker (polar_pmd.py:374 "PPI irregular (0 → per-beat, not back-timed)"), and it never becom |
| `capture-host/polar_pmd.py:487` | rng = (s.get(0x02) or [DEFAULT_RANGE[meas]])[0] or DEFAULT_RANGE[meas] | Not absence-as-a-number: axis_scale (polar_pmd.py:480-490) is a decode constant, and when the device reports no settings menu build_start (polar_pmd.py:446-453) sends no range TLV, |
| `capture-host/polar_pmd.py:592` | fs = fs or SAMPLE_HZ.get(meas, 0) or 1 | The `or 1` arm is unreachable as a timebase: an unknown meas never reaches back-timing because decode_frame raises `ValueError(... not decoded)` at polar_pmd.py:632-633 before fs i |
| `capture-host/polar_pmd.py:685` | back = 0 if ppi else (n - 1 - i) | `back = 0` for PPI is a documented refusal to back-time an event stream (polar_pmd.py:627-628, 685), and the claimed consumer does not exist: capture.py:3277 calls `wr.write_ppi(sm |
| `capture-host/polar_psftp.py:152` | name, size = None, 0   # then `if name is not None: entries.append((na | At polar_psftp.py:152-157 the `size` default is only reachable when a PbPFtpEntry omits field 2, and the two ways that happens are both already handled out-of-band: directory entri |
| `capture-host/polar_psftp.py:392` | err = (pkt[1] \| (pkt[2] << 8)) if len(pkt) >= 3 else 0 | The `err = 0` on a sub-3-byte terminator is the documented decoding of a legal frame, not a fabricated status: test_polar_psftp_client.py:1350 pins it ("a bare terminator means 'do |
| `capture-host/polar_psftp.py:471` | _dt.datetime(dd[1], dd[2], dd[3], tt.get(1, 0), tt.get(2, 0), tt.get(3 | REFUTED: PbTime is proto2 with all-optional members, where an omitted field IS the encoded value 0 — the file states this on its own encoder side (`polar_psftp.py:267`: "hours/minu |
| `capture-host/polar_psftp.py:680` | total = sum(sz for _, sz in files) or 1 | polar_psftp.py:678 filters the walk to `s >= 0`, so absent/unreadable sizes (walk yields -1 at line 517; truncated dirs are separately recorded and warned at 518-524) are EXCLUDED |
| `capture-host/probe_pmd_surface.py:445` | settings = pmd.parse_settings_response(await cp.send(sweep_cmd(OP_GET_ | `or b""` feeds a documented "empty on error/short" parser (polar_pmd.py:325-341) which returns `{}`, and `build_start` treats empty settings as the explicitly-documented hardware-v |
| `capture-host/probe_pmd_surface.py:504` | offset_min = int(tz.total_seconds() // 60) if tz else 0 | The claimed absence branch is unreachable: `_dt.datetime.now().astimezone()` (probe_pmd_surface.py:503) always returns an aware datetime with a concrete fixed-offset tzinfo, so `ut |
| `capture-host/probe_verity_survey.py:211` | return {pmd.MEAS_NAME[m]: pmd.ACTIVE_NAME.get(st, st) for m, st in sor | `probe_verity_survey.py:211` feeds `pmd.parse_status_response`, whose docstring (`polar_pmd.py:240-241`) documents `{}` as "the device did not tell us" — an empty container, not an |
| `capture-host/probe_verity_survey.py:305` | settings = pmd.parse_settings_response(await cp.send(pmd.get_settings_ | `got["negotiated"]` decodes the bytes actually sent (`_settings_from_start(cmd)`, probe_verity_survey.py:312/344-358) and is published beside `start_cmd` (:311) and the device's ow |
| `capture-host/pull_session.py:488` | n_samples = max(0, (len(data) - 10 - 48)) // 3 if len(data) > 58 else | The `else 0` is arithmetically identical to the true branch, so it fabricates nothing: at len(data)==58 the expression max(0, 58-10-48)//3 is already 0, and for any len(data)<58 th |
| `capture-host/pull_session.py:505` | "finalized": bool(summary), | `bool(summary)` is a byte test over data already fully in memory: oxyii.py:1203-1207 returns None only when len(data)<48 or the 48-byte sub-magic is absent ("# not finalised (or no |
| `capture-host/pull_session.py:507` | "trailer": bytes(data[-48:]).hex() if len(data) >= 48 else "", | At pull_session.py:507 the `""` is an OUT-OF-BAND marker, not a sentinel inside the value's range: a real trailer is always exactly 96 hex chars, so empty is unambiguous, and the g |
| `capture-host/radioclock.py:582` | self.offsets.add(host_ns / 1000.0, anchor_us) | Line 582 (`radioclock.py:582`) stores a genuine measurement — `(vs_rx_us − anchor_us)` from a real vendor anchor report — with no zero, default or sentinel anywhere in `OffsetTrack |
| `capture-host/radioclock.py:778` | return {"rows": written, "devices": sorted(writers_by_device), "missed | Absence is already null everywhere it occurs: associate() returns (None, None) for all three not-measured cases with a documented rationale (radioclock.py:304-334), and format_row |
| `capture-host/radioclock.py:932` | if manufacturer != NORDIC_COMPANY_ID:  … "controller %s reports manufa | Traced forward: decide() returns (None, [], why) at capture-host/radioclock.py:931-933, and the only consumer is main() at capture-host/radioclock.py:975-977 — `log.info("%s", why) |
| `capture-host/sealbox.py:235` | "Tepna-Capture-Host-Version": version if version else "null", "Tepna-C | These are BagIt `bag-info.txt` metadata headers, not measurements: `sealbox.py:225-242` builds them for `_seal.seal_night(extra_info=…)` (line 371), and `seal.py:102` merges them i |
| `capture-host/sealbox.py:250` | return "yes" if c is True or c == "yes" else "no" | Absence here IS null and is handled explicitly: `consent_value` returns `None` for a missing/None `seal.research_consent` (sealbox.py:248-249), `extra_info` writes the literal `"nu |
| `capture-host/storage_targets.py:297` | kind = target.get("kind") or PROTOCOLS.get(target.get("protocol", ""), | storage_targets.py:297's default is a classification fallback, and its branch (:322-323) is an explicitly documented non-check — "a transfer target is probed by test_target(), not |
| `capture-host/storage_targets.py:322` | return {"ready": True, "path": None, "reason": None} | The transfer branch is a documented, test-locked semantic ("ready to be TRIED"), not a fabricated measurement: `storage_targets.py:322-323` carries the inline reason and `tests/tes |
| `capture-host/storage_targets.py:433` | return p.returncode or 0, (out or b"").decode("utf-8", "replace") | At storage_targets.py:430-433 stdout is `asyncio.subprocess.PIPE` with stderr merged in, so `proc_util.communicate` (proc_util.py:33-42) returns bytes — never None — making `out or |
| `capture-host/storage_targets.py:433` | (out or b"").decode("utf-8", "replace") | At storage_targets.py:430-433 stdout is `asyncio.subprocess.PIPE` with stderr merged in, so `proc_util.communicate` (proc_util.py:33-42) returns bytes — never None — making `out or |
| `capture-host/telemetry.py:335` | st = st or {}\n    if not st.get("connected"): return False | `connected` is a HOST-side fact, not a device-reported measurement: the box's own connection manager writes `capture.py:2764`/`STATUS["devices"]`, so a missing entry (`capture.py:9 |
| `capture-host/telemetry.py:664` | return bool(full_battery_implies_charging(lvl, now - store[name], min_ | `note_flat_battery` is not a measurement channel but a two-valued *inference-fired?* predicate: it is declared `-> bool` (telemetry.py:645), its own non-inference branch already re |
| `capture-host/telemetry.py:938` | "fs": m.fs if m else 0, | `telemetry.py:938`'s `fs` is a DECLARED nominal constant, not a measurement — `StreamMeta.fs` documents `0 for irregular / per-event` (telemetry.py:697), while the measured counter |
| `capture-host/timeline.py:132` | dur = f["rows"] / fs | `dur = f["rows"] / fs` (timeline.py:132) is not a sentinel standing for absence: `f["rows"]` is a genuine measured row count and `fs` a configured rate, so the fallback is a comput |
| `capture-host/timeline.py:282` | i_ts, i_dev = idx.get("Phone timestamp", 0), idx.get("device", 1) | The defaults at timeline.py:282-283 are COLUMN INDICES, not measurement values, and they match the sole producer's fixed layout exactly — writers.py:2369-2370 (`LinkLogWriter`) wri |
| `capture-host/timeline.py:307` | rows.append((dev, addr, ts, 1 if p[i_c] == "1" else 0, r)) | The `connected` field has no absence to encode: its sole producer, `LinkLogWriter.write(..., connected: bool, ...)` (capture-host/writers.py:2376-2390, called only from capture.py: |
| `capture-host/timeline.py:473` | fs = nightqc._expected_hz(d, s) or 0 | `nightqc._expected_hz` (nightqc.py:393-406) honestly returns `None` for an unknown rate, and the `or 0` at timeline.py:473 is consumed by exactly one thing — the documented refusal |
| `capture-host/timeline.py:482` | "coverage_pct": round(100 * covered / (t1 - t0), 1) if t1 > t0 else 0. | `coverage_pct` is a genuine measurement, not a stand-in for absence: `covered` is the overlap-merged union of intervals actually observed (timeline.py:62-76) over a window derived |
| `capture-host/webmon.py:337` | "charging": bool(st.get("charging")), | webmon.py:337's bool() is deliberate and pinned by tests/test_webmon_state_contract.py:210 (`d["charging"] is False` for a never-reported device, explicitly excluded from the must- |
| `capture-host/webmon.py:987` | return "H10" if "h10" in blob else ("Verity" if ("verity" in blob or " | `_model_of` (webmon.py:985-987) is a total classifier over the closed device set the daemon can actually capture from — capture.py:8229 dispatches only `vendor in ("Wellue","Viatom |
| `capture-host/webmon.py:1155` | "sdk_capable": hex(pmd.SDK_MODE) in seen_flags, | `sdk_capable` is not a measurement but a documented fail-closed affordance gate: webmon.py:1139-1147 states the rule ("a switch that cannot work is worse than an absent one… the ca |
| `capture-host/webmon.py:1678` | dev_id = dev.get("device_id") or address.replace(":", "")[-8:] | Traced `dev_id` forward: it appears ONLY in the `out_dir` directory name under `<root>/captures/stored/Polar_<model>_<id>_offline_<session>` (webmon.py:1679-1680) and nowhere else |
| `capture-host/webmon.py:1694` | return web.json_response({"ok": bool((manifest or {}).get("ok", True)) | The sole producer always supplies the verdict: `polar_psftp.pull_recording` has one return path and sets `manifest["ok"] = not got["short"]` unconditionally before returning (/home |
| `cgm-hrv-coupling-analysis.js:237` | return out.length >= 13 ? out.join('\n') + '\n' : null; // need ≥~1 h | The line is a refusal, not a fabricated value: `sliceNocturnal` returns `null` (never 0/default) when the window holds <13 readings, which is exactly §∅'s prescribed shape. More de |
| `cgm-hrv-coupling-analysis.js:241` | function mean(a) { return a.length ? a.reduce(function (x, y) { return | Every call site of `mean` in this file is guarded to a provably non-empty array: the `ns.length < 2` early return at cgm-hrv-coupling-analysis.js:451 and :673 precedes the `mg`/`mm |
| `cgm-hrv-coupling-analysis.js:375` | cpap: !!gn.cpap | Refuted: every row that reaches line 375 provably has a real ground-truth entry, so `gn` is never the `{}` fallback there. cohort-worker.js:531-535 skips adding a night to `nocturn |
| `cgm-hrv-coupling-analysis.js:380` | nHypo: g.nHypo \|\| 0,               nHypoWin: g.winHypo \|\| 0, | Traced the producer: `cohort-worker.js:285` sets `nHypo: (r.nocturnalHypo \|\| []).length` and `winHypo: winHypoFromCSV(...)` — both are unconditional integer counts over the actuall |
| `clock.js:114` | se = se \|\| 0; ms = ms \|\| 0; | clock.js:113-114 is an ES5 arity default inside the private builder `_ckMk`; every call site whose format can omit seconds already supplies its own value (clock.js:152,158,182,188, |
| `clock.js:396` | var half = se > 0 ? 1.96 * se : 0; | The `: 0` branch is not a fabricated measurement standing in for an unmeasured SE — it is a documented refusal-scope decision whose absence still travels as null in the published r |
| `clock.js:526` | var ppm = (sm[n - 1] / span) * 1e6; | `ppm` at /home/michal/wt-absence-survey-kst/clock.js:526 is a genuine derived measurement over observed anchor pairs — `sm[n-1]` is the running median of real host−device residuals |
| `clock.js:652` | var curve = _ckAllanFromPhase(ph, spanSec / (n - 1)); | clock.js:650-652 computes tau0 from observed quantities only — spanSec is the measured device-time span between the first and last real anchor and n is the count of anchors that ac |
| `clock.js:732` | if (!isFinite(x)) return 0; | At clock.js:730-744 `correctionAt` is contractually "ms to ADD to the device axis", and every consumer in the tree uses it that way — ppgdex-dsp.js:1072 `(devMs + correctionAt(devM |
| `cohort-gen.js:143` | if (!(u > 0 && u < 1)) return 0; | cohort-gen.js is a synthetic cohort GENERATOR — nothing on the invNorm path observes a device or subject, so there is no measurement whose absence could be fabricated (§∅ governs c |
| `cohort-gen.js:356` | if (t) lines[idx] = t + ',--,--,0'; | The real O2Ring writes this exact byte pattern itself: `grep ',--,--' "uploads/O2Ring S 2100_20260513225000.csv"` returns rows literally of the form `02:27:21 14/05/2026,--,--,0` — |
| `cohort-gen.js:618` | annotations: ann.length ? ann : [{ class: 'Unclassified', durSec: 0, o | The record is the faithful model of a real EDF+ timekeeping TAL, not a filler for absence: cpapdex-edf.js:151 classifies any non-event text (e.g. the device's 'Recording starts', p |
| `cohort-worker.js:189` | estAHI: firstFinite(night.ahiEst) | night.ahiEst is a fixed two-key object {ahiODI4, ahiKulkas} from computeAHIestimates (oxydex-dsp.js:2854), attached unconditionally at oxydex-dsp.js:2978 (re-exported as n.ahiEst\|\| |
| `cohort-worker.js:216` | clean.reduce(function (s, v) { return s + v; }, 0) / 60000 | REFUTED on two independently sufficient grounds. (1) The premise is factually wrong: `PulseDex._bare.artifactClean` (pulsedex-dsp.js:909-938) returns `out = vals.slice()` with flag |
| `cohort-worker.js:244` | if (!csv) return 0; | The `if (!csv) return 0;` branch is unreachable defensive code, not an absence sentinel: all three call sites of `runGluco` guard the CSV first (`cohort-worker.js:505` `if (pi.file |
| `cohort-worker.js:268` | cells.push({ tMs: s.gT[i], v: s.gV[i], f: s.gF ? s.gF[i] : 0 }); | The `: 0` fallback is unreachable: `cohort-worker.js:268` runs only when `s.gT && s.gV`, and `glucodex-dsp.js:1534` builds `series` from one allocation block (`glucodex-dsp.js:467- |
| `cpapdex-app.js:112` | LOADED_NIGHTS.sort(function (a, b) { return (a.t0Ms \|\| 0) - (b.t0Ms \|\| | The absence is refused upstream, not defaulted: cpapdex-edf.js:59/70/72 `parseEdfClock` returns null on an unparseable/out-of-range/rolled start date, and cpapdex-dsp.js:976 `build |
| `cpapdex-app.js:575` | e.buf = simulateOximetrySA2(e.buf, eventTimesMs); | The claim's premise — "demo night's SA2 carries NO oximeter (all-sentinel)" — is false for the shipped demo set: DEMO_FILES are the committed synthetic EDFs (cpapdex-app.js:512-528 |
| `cpapdex-app.js:604` | var recDur = parseFloat(trim(244, 8)) \|\| 1; | cpapdex-app.js:604 sits inside `simulateOximetrySA2`, a demo-only synthetic-trace generator (invoked only from `loadDemo`, lines 572-579) that writes fabricated SpO2/Pulse bytes in |
| `cpapdex-app.js:770` | spanDays: chrono.length > 1 ? Math.round(((chrono[chrono.length - 1].t | A null t0Ms sorts to index 0 under the `(a.t0Ms \|\| 0)` comparator at cpapdex-app.js:755-757 (same at :818-820), so exportName receives `t0Ms = null` and dex-export.js:90-93 stamps |
| `cpapdex-cross.js:410` | return h != null ? Math.max(0.05, Math.min(1, h / 6)) : 1; | `nightWeight` (cpapdex-cross.js:408-411) produces a relative aggregation WEIGHT, not a surfaced or exported measurement — nothing downstream reports it as therapy hours, and the ac |
| `cpapdex-cross.js:463` | var h = n.therapyHours != null ? n.therapyHours : n.metrics ? n.metric | The `: 0` default lives in `CPAPCross.compliancePct` (/home/michal/wt-absence-survey-kst/cpapdex-cross.js:458-467, exported at :812), and a repo-wide grep for `compliancePct(` find |
| `cpapdex-cross.js:532` | if (nScale <= 0) nScale = 1e-9; | At cpapdex-cross.js:531 `nScale` is the median of \|successive diffs\| over the actual series (`adiff` is non-empty by construction — the function returns early at line 500 unless n |
| `cpapdex-edf.js:131` | durSec: duration ? parseFloat(duration) : 0 | In EDF+ the `\x15<duration>` segment is omitted precisely to mean the annotation is an instantaneous marker, not "duration unknown", so `durSec: duration ? parseFloat(duration) : 0 |
| `cpapdex-edf.js:131` | durSec: duration ? parseFloat(duration) : 0  // parseFloat of a malfor | In EDF+ the `\x15<duration>` segment is omitted precisely to mean the annotation is an instantaneous marker, not "duration unknown", so `durSec: duration ? parseFloat(duration) : 0 |
| `cpapdex-fusion.js:78` | var sqi = s.sqi != null ? s.sqi : 1; | At cpapdex-fusion.js:78 `s.sqi` is always populated: both session producers set it unconditionally (cpapdex-dsp.js:381 `sqi: leakSqi(m)` in buildSession, and cpapdex-dsp.js:1191/12 |
| `cpapdex-fusion.js:81` | var tMs = ev.tMs != null ? ev.tMs : s.t0Ms + (ev.timeSec \|\| 0) * 1000; | parseTAL only emits an annotation when `!isNaN(onsetSec)` (cpapdex-edf.js:129-132), so every EVE annotation carries a finite onset; eveEvents then always writes a finite `timeSec` |
| `cpapdex-fusion.js:167` | if (o.desatCount != null && o.analyzedHours) { desats += o.desatCount; | The producer makes the "dropped session" branch unreachable: `oximetryLane` (cpapdex-dsp.js:688-770) returns `available:true` only after `valid > 0 && coverage >= OXI.COVERAGE_FLOO |
| `cpapdex-fusion.js:172` | below90 += o.below90Samples \|\| 0; | The only producer of an oximetry object with `available: true` is `oximetryLane`'s return at /home/michal/wt-absence-survey-kst/cpapdex-dsp.js:755-769, which emits `validSamples: v |
| `cpapdex-fusion.js:331` | return a + (s.sqi != null ? s.sqi : 1); | At the claimed site the `: 1` branch is unreachable defensive code: every session object reaching this reduce is built by `buildSession`/the main session builder, both of which set |
| `cpapdex-registry.js:434` | return String(s == null ? '' : s).toLowerCase() | Line 434 is a defensive coercion inside `_norm`, a label-string normaliser — it handles a lookup KEY, not a measured value, so §∅ (a measurement must be null, never a number/sentin |
| `cpapdex-registry.js:493` | if (fallback && !_META_DENY[_norm(label)]) return global.MetricRegistr | The claim's consumer chain is false: cpapdex-render.js:38 and :311 route through CpapRegistry.evBadge (cpapdex-registry.js:501-505 → MetricRegistry.entry), never through badgeForLa |
| `cpapdex-registry.js:503` | var d = global.MetricRegistry.entry(CPAP_REGISTRY, id); return global. | Both "dynamic" call sites resolve to closed literal id sets that are all registered: cpapdex-render.js:1073 `_cpapEventId` is a switch returning exactly one of hypopneaIndex/reraIn |
| `dex-ingest.js:133` | return 'ecg'; // default — a bare waveform is the ECG | dex-ingest.js:133 is a documented routing default for a file the user deliberately dropped on ECGDex, not a value standing for an unmeasured quantity; dex-ingest.js:108 and :78-80 |
| `dex-ingest.js:157` | return 'ppg'; // default — assume a bare waveform | `ppgKind`'s final `return 'ppg'` is a routing/dispatch label, not a measured physiological quantity — nothing about "not measured" is being encoded as a number or in-band sentinel, |
| `dex-ingest.js:266` | var cd = deviceKey(candidateName); if (!cd) return true; | Absence is already represented as null and travels as null: `deviceKey` returns `null` for unstamped/non-Polar names (dex-ingest.js:45-48), and `_isDeviceEligible` (dex-ingest.js:2 |
| `dex-ingest.js:296` | if (refMs == null) return candidates.length === 1 ? candidates[0] : nu | At /home/michal/wt-absence-survey-kst/dex-ingest.js:285-307 the function returns a candidate OBJECT or null — it never publishes the distance, so no numeric value stands in for the |
| `ecgdex-app.js:2553` | tot = r.totSleep \|\| 0;  …  totalSleepMin: tot | The claim's premise is false: `r.totSleep` is never null/undefined. `ecgdex-dsp.js:3095-3100` initializes `stageMin = {Wake:0,REM:0,Light:0,Deep:0}`, accumulates observed epoch dur |
| `ecgdex-app.js:2568` | plausibility: flags.length ? { ok: false, issues: flags } : { ok: true | The claimed absence path is nearly unreachable and, where it exists, it is distinguishable in the same object: `stageMin` is built at ecgdex-dsp.js:3095 as `{Wake:0,REM:0,Light:0,D |
| `ecgdex-app.js:2596` | accEx.agreement.r >= 0.85 \|\| (accEx.agreement.mae <= 1.5 && Math.abs(a | The producer (ecgdex-dsp.js:4426-4464) assigns `agreement` only inside `if (pairs.length >= 3)` as one object literal whose `mae`/`meanDelta`/`sdDelta`/`r` are all `+x.toFixed(2)` |
| `ecgdex-app.js:2631` | totalSteps: accEx.gait.totalSteps \|\| 0, | The `\|\| 0` at /home/michal/wt-absence-survey-kst/ecgdex-app.js:2631 is a no-op (the DSP already returns the literal `totalSteps: 0` for lowfs at ecgdex-dsp.js:4238), and it is emit |

## 5 · Unverified (744) — the population the limit and the per-unit cap left unjudged

By severity: {'medium': 362, 'low': 235, 'high': 147}. Expect ~18 % of these to survive verification if the judged population is representative — i.e. **on the order of 130 more real instances**, concentrated where the counts below are largest. Full records with rationale and consumer trace are in the JSON.

| file | unverified findings |
|---|---|

| `oxydex-dsp.js` | 62 |
| `oxydex-render.js` | 45 |
| `ppgdex-dsp.js` | 34 |
| `ecgdex-dsp.js` | 29 |
| `integrator-dsp.js` | 25 |
| `glucodex-app.js` | 12 |
| `glucodex-dsp.js` | 12 |
| `sensor-trio-worker.js` | 12 |
| `ecgdex-profile.js` | 11 |
| `hrvdex-dsp.js` | 11 |
| `pulsedex-dsp.js` | 11 |
| `ecgdex-app.js` | 10 |
| `ecgdex-morph.js` | 10 |
| `hrvdex-profile.js` | 10 |
| `hrvdex-render.js` | 10 |
| `resp-acc-analysis.js` | 10 |
| `sigma-no-reference-analysis.js` | 10 |
| `motiondex-dsp.js` | 9 |
| `oxydex-fusion.js` | 9 |
| `ppgdex-app.js` | 9 |
| `pulsedex-app.js` | 9 |
| `cpapdex-dsp.js` | 8 |
| `oxydex-cross.js` | 8 |
| `oxydex-profile.js` | 8 |
| `pat-feasibility-worker.js` | 8 |
| `ppgdex-profile.js` | 8 |
| `analysis-stats.js` | 7 |
| `cohort-worker.js` | 7 |
| `cpapdex-fusion.js` | 7 |
| `cpapdex-render.js` | 7 |
| `ecgdex-render.js` | 7 |
| `integrator-longitudinal.js` | 7 |
| `pulsedex-overview.js` | 7 |
| `pulsedex-render.js` | 7 |
| `capture-host/writers.py` | 6 |
| `glucodex-profile.js` | 6 |
| `hrv-confound-analysis.js` | 6 |
| `nsrr-adapter.js` | 6 |
| `ppgdex-cross.js` | 6 |
| `ppgdex-render.js` | 6 |
| `resp-acc-analysis-app.js` | 6 |
| `synth-gen.js` | 6 |
| `capture-host/nightqc.py` | 5 |
| `eegdex-dsp.js` | 5 |
| `event-coupling.js` | 5 |
| `hrvdex-chart.js` | 5 |
| `integrator-app.js` | 5 |
| `integrator-render.js` | 5 |
| `nights-icc-analysis.js` | 5 |
| `odi-bias-analysis.js` | 5 |
| `pat-align.js` | 5 |
| `treatment-response-analysis.js` | 5 |
| `motiondex-render.js` | 5 |
| `pulsedex-cross.js` | 5 |
| `dex-profile.js` | 4 |
| `glucodex-render.js` | 4 |
| `overdex-app.js` | 4 |
| `oxydex-app.js` | 4 |
| `pat-feasibility.js` | 4 |
| `qrs-yield-analysis.js` | 4 |
| `sensor-trio-power-analysis.js` | 4 |
| `signal-orchestrate.js` | 4 |
| `ecgdex-cross.js` | 4 |
| `capture-host/cpap_stream_watch.py` | 4 |
| `crossnight-envelope.js` | 4 |
| `cpapdex-coimport.js` | 4 |
| `capture-host/loss_audit.py` | 4 |
| `metric-registry.js` | 4 |
| `ppgdex-morph.js` | 4 |
| `capture-host/cpap_harvest.py` | 3 |
| `capture-host/probe_verity_survey.py` | 3 |
| `capture-host/timeline.py` | 3 |
| `capture-host/oxyii.py` | 3 |
| `cpapdex-cross.js` | 3 |
| `capture-host/webmon.py` | 3 |
| `hrvdex-app.js` | 3 |
| `night-seal.js` | 3 |
| `integrator-tch.js` | 3 |
| `qrs-equiv-analysis.js` | 3 |
| `sensor-trio-gpu.js` | 3 |
| `support.js` | 3 |
| `capture-host/clockcfg.py` | 3 |
| `capture-host/acq_evidence_cpap.py` | 3 |
| `oxydex-util.js` | 3 |
| `capture-host/probe_pmd_opcodes.py` | 3 |
| `capture-host/probe_oxyii_0x03.py` | 3 |
| `qrs-yield-worker.js` | 3 |
| `capture-host/allan.py` | 2 |
| `oxydex-registry.js` | 2 |
| `ppgdex-registry.js` | 2 |
| `capture-host/bonding.py` | 2 |
| `capture-host/cpap_edf_writer.py` | 2 |
| `verdict.js` | 2 |
| `signal-frame.js` | 2 |
| `capture-host/rec_to_psl.py` | 2 |
| `capture-host/probe_verity_offline.py` | 2 |
| `capture-host/link_distress.py` | 2 |
| `capture-host/host_clock.py` | 2 |
| `capture-host/night_report.py` | 2 |
| `capture-host/probe_buzz_fiducial.py` | 2 |
| `capture-host/mutation_diff.py` | 1 |
| `capture-host/o2ring.py` | 1 |
| `cpapdex-edf.js` | 1 |
| `capture-host/telemetry.py` | 1 |
| `ecgdex-registry.js` | 1 |
| `capture-host/ble_visibility.py` | 1 |
| `capture-host/as11_pull.py` | 1 |
| `capture-host/capture_status.py` | 1 |
| `capture-host/adapter_ab.py` | 1 |
| `capture-host/adversarial_capture.py` | 1 |
| `signal-adapters.js` | 1 |
| `glucodex-registry.js` | 1 |
| `data-unifier-app.js` | 1 |
| `capture-host/cpap_supervisor.py` | 1 |
| `capture-host/diskguard.py` | 1 |
| `capture-host/devcaps.py` | 1 |
| `capture-host/probe_polar_usb.py` | 1 |
| `capture-host/status_union.py` | 1 |
| `capture-host/wifi_uplink.py` | 1 |
| `cohort-regression.js` | 1 |
| `capture-host/viatom.py` | 1 |
| `capture-host/mmeta.py` | 1 |
| `capture-host/jitterfloor.py` | 1 |
| `capture-host/oxy_inventory.py` | 1 |
| `capture-host/nightarchive.py` | 1 |
| `capture-host/night_verdicts.py` | 1 |
| `capture-host/mutation_triage.py` | 1 |
| `motiondex-app.js` | 1 |
| `overdex-walk.js` | 1 |
| `hrvdex-registry.js` | 1 |
| `motiondex-registry.js` | 1 |
| `capture-host/probe_oxyii_opcodes.py` | 1 |
| `capture-host/probe_oxyii_ppg.py` | 1 |
| `capture-host/probe_polar_onboard.py` | 1 |
| `capture-host/ppg_grid_check.py` | 1 |
| `capture-host/oxy_restart.py` | 1 |
| `capture-host/parse_dat.py` | 1 |
| `pat-gate.js` | 1 |
| `provenance-banner.js` | 1 |
| `pulsedex-registry.js` | 1 |

## 6 · Done when

- [ ] Owner reads §1 and §2 and rules which of: (a) each row to `RESIDUE.md` as its own unit, (b) F1–F4
      folded into `SAMPLE-VALIDITY-ENVELOPE` as the sidecar programme's first work list, (c) both.
- [ ] The five device-emitted findings in §5 are verified by hand (they are the sidecar's population).
- [ ] The §5 population is re-run through the two lenses when budget allows (resume the workflow from
      its journal; the finder results are cached).
- [ ] Every fix cites its row and lands with a **planted control** that fails on `origin/main` before the
      fix is accepted (the standard #2902 set).

## 7 · Related

`FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md` (DONE) · `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` ·
`CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md` (§∅ at the evidence layer) · CLAUDE.md §∅, §🔒 §2.6/§2.7 ·
#2897 · `audits/ABSENCE-SURVEY-2026-09-22.json`.
