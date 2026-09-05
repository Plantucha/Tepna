<!--
  CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED (parked 2026-09-02 — §2's V1–V5 remain the only open set and they are hardware-gated in three different ways, which is worth separating: **V1/V2** need a Polar Sensor Logger export of a Verity `_GYRO`/`_MAG` and an H10 `_ACC` to byte-diff against our decoders (phone + hardware, off the box; the decoders themselves have synthetic known-answer coverage at `tests/test_polar_pmd.py:179-252`). **V4** needs a real NTP step on the box. **V5's apply path** needs an owner-authorized box deploy (`sudo bash deploy/enable-clock-control.sh`); V5's drift half is CLOSED — gate-backed by `deploy/check-system-files.sh` and surfaced nightly by `nightqc.system_file_drift`. ⚠ **V3 UNSUPPLIABLE, RETIRED 2026-09-02** (Kestrel deputy ruling, reversible by the owner): its residual asks for a byte-diff against a vendor PPI export, and Polar Sensor Logger never produced one — so no owner action closes it with the current vendor app. Retired rather than deleted, and rather than carried open forever; it appears in the 2026-09-02 drain report so the owner can reverse it. **RE-TRIAGED 2026-09-06:** nothing to verify in the `.py` — the parked state is correct and unchanged. V1/V2/V4/V5-apply are gated on inputs no repo-side change can produce (a Polar Sensor Logger export, a real NTP step, an owner-authorized box deploy); V3 stays retired; V5's drift half stays closed. Zero `- [ ]` items, so there is no open § to stamp — the header IS the state. **Owner:** Vigil box · **Next step:** retire V3's residual, then the PSL capture for V1/V2) · **Created:** 2026-07-16
`capture-host/` test suite is green (~40 files incl. `test_capture_clock` F2, `test_pmd_delta`,
`test_oxyii`, writers/fsync R1) and real captured files round-trip to node-exports (H10 ECG → ECGDex 21
events, O2Ring SpO₂ → OxyDex meanSpo₂ 96.1 %). **§2 V1–V5 stay OPEN — all hardware-gated** exactly as
this brief's §116 states: V1/V2 need PSL `_GYRO`/`_MAG`/`_ACC` byte-diffs, V3 an OH1, V4 an observed NTP
step, V5 the clock sudoers rule. No new desk work available; the remainder rides real hardware/overnight.)

# CAPTURE-HOST follow-ups II — full multi-stream capture, the Tepna monitor, clock/NTP control

The `-II` follow-on to [`CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md).
Everything here is **out-of-suite** (`capture-host/`) — no Dex bundle / provenance / gate impact. It records
what the second bring-up session surfaced and is **not yet done**. Parent `CAPTURE-HOST` stays PROPOSED.

## 0 · What this session shipped (context)
- **Full multi-stream capture** (committed `645810d` on `claude/vigil-capture-parity`, NOT pushed, branch is
  behind `main` → rebase before a PR): Verity PPG now **4-channel** (3 LEDs + ambient), Verity **ACC/GYRO/MAG**,
  H10 **ACC** + **RR** (raw tachogram), O2Ring **motion/worn**, **battery** on every device. PMD **settings
  negotiation** (`get_settings`→`build_start`) replaces the per-device-wrong fixed START; **STOP-before-START**
  clears stale streams; feature-read gates START. Multi-channel telemetry bus, device-qualified keys, one
  multiplexed SSE (`/api/stream/_all`). Monitor rewritten onto the Tepna design system with an Overview page.
- **Clock / NTP / timezone control + monotonic capture clock** (UNCOMMITTED in the main checkout as of this
  writing): `clockcfg.py` + `tepna-clock.sh` (NOPASSWD-sudo helper) + `/api/clock*` routes + a Clock &
  Contract card in the monitor; `capture.py` `_now()` is now CLOCK_MONOTONIC-anchored (NTP-step-immune).

## 1 · Correctness / bugs to fix — **ALL THREE EXECUTED 2026-07-18**
- **F1 · Empty-vendor writer artifact — FIXED (daemon), and the second half CLOSED 2026-07-18.** A
  remembered/hot-spawned device with a blank `vendor`/`model` produced `__AC028496_<ts>_ECG.txt` (0 bytes) —
  `guessDevice()` in `monitor.html` falls through to empty vendor/model + a device_id derived from the MAC,
  and `run_polar`/`capture_filename` opened a writer anyway. **Fixed:** `capture.py` `_spawn` refuses any
  device missing `name`/`vendor`/`model`/`device_id`. **The "optional follow-up" was not optional** — with
  only the daemon checking, the monitor still POSTed the bad device, `webmon.remember` persisted it to
  `config.yaml`, and the UI answered `remembered ✓` for a device that would never record a byte. Now the
  identity list is single-sourced as `writers.IDENTITY_FIELDS`/`missing_identity()` (next to the filename it
  protects) and enforced in BOTH paths: `remember` rejects with **400** before `_save()`, and the monitor
  shows `not recognised — needs vendor, model` and re-enables the button instead of a false ✓.
- **F2 · DST re-anchor is non-monotonic — FIXED 2026-07-18.** Resolved as option (a), but keyed on the
  **zone, not the magnitude**: at a transition the local UTC offset moves by the same amount as the apparent
  drift, whereas an NTP correction moves the clock with the offset unchanged — so the two are told apart
  exactly rather than by a whole-hour heuristic (a −3600 s *correction* with no zone change must still
  re-anchor, and does; a magnitude test would have wrongly excused it). `_now()` absorbs the civil
  relabelling into `_civil_shift` and keeps counting in the session's original offset frame, so a night
  crossing the fall-back stays monotonic and 1:1 with elapsed real time. `_reanchor(shift)` carries the
  absorbed shift forward, so a genuine NTP step landing *after* a transition re-anchors **within** that
  frame instead of dropping back to civil time (which would have rewound the file by the transition width
  — the compound case the original fix missed). Ten tests in `tests/test_capture_clock.py`, each
  mutation-verified, including that one transition logs **once**, not per 130 Hz sample.
- **F3 · `incoming_subdir` is vestigial — DROPPED 2026-07-18.** The key is gone from
  `config.example.yaml`; `writers.night_dir()`'s straight-to-`captures/<YYYY-MM-DD>/` behavior is now what
  the comment describes (no staging dir, so nothing has to be moved and an interrupted night is already
  where you would look for it). The night-roller is deliberately NOT built — it would only move a file
  that already lands in the right place. `how-to-collect/health-box.md` said `captures/incoming/` too and
  was corrected with it.

## 2 · Unvalidated code — verify before trusting a night
> ### 📊 V1–V3 measured against the PSL corpus, 2026-08-04
>
> The blocker on V1/V2 was *"we have no vendor export to diff against."* There is one: **19 GB of Polar
> Sensor Logger output** at `/run/media/michal/647A504F7A50205A/Ecg nightly/` (2026-05-03 → 07-12) —
> 16.9 M GYRO rows, 6.7 M MAGN, 39.6 M ACC — and the box's own decode of the **same physical devices**
> (Verity `0C301E3F`, H10 `02849638`) under `/srv/tepna/captures/`. Both write identical headers and
> declared units, so they compare directly.
>
> Different sessions, so this is a **physical-invariant** comparison, not the byte-diff V1 asks for:
>
> | stream | box (`polar_pmd.py`) | PSL (vendor) | verdict |
> |---|---|---|---|
> | **ACC · H10** | median \|a\| **996.2 mg** | **992.5 mg** | both ≈ 1 g. **Agree to 0.4 %** — and \|a\|=1 g at rest is a hard invariant, so a wrong scale (2×, 16×, …) could not hide. **V2's units question is ANSWERED** |
> | **MAG · Verity** | median 0.992 G | 0.932 G | same units (G), same order. 6.5 % apart across different sessions/orientations — magnetometers see local ferrous distortion, so this confirms the decode agrees, not a calibration |
> | **GYRO · Verity** | median 3.76 dps | 4.93 dps | ⚠️ **not a scale proof.** Resting \|gyro\| is bias+noise, not a physical constant, so it cannot bound a scale factor. It confirms units (dps) and order only |
>
> **What this does NOT close, stated plainly:** V1's *first* claim is that the **uncompressed** GYRO/MAG
> branches (`base==0`) are untested. This corpus cannot fix that — the Verity streams **delta** frames, so
> both sides exercised the delta path. The uncompressed branch stays untested until a device emits one.
>
> **V3 is CONFIRMED DEAD, with numbers.** The corpus holds **107 PPI files totalling 102 rows** — header
> only, zero with >100 rows. That is not "no data available", it is positive evidence for V3's claim that
> the unit accepts PMD START and streams 0 frames. ⚠️ Counting *files* would have read as "107 PPI
> recordings, V3 unblocked"; reading *values* says the opposite.
>
> > **🔴 OVERTURNED 2026-08-08 — the numbers were right and the CONCLUSION was wrong.** Those 102 rows
> > measure **Polar Sensor Logger**, not the Verity. The box's own capture path gets real PPI from the
> > *same physical unit* (`0C301E3F`): **30 151 rows** on 2026-08-07, 1.2 MB, and 965 KB the night before.
> > So the unit does **not** "accept START and stream 0 frames" — it streams fine, and what was dead is
> > PSL's PPI capture. Three claims in V3 below fall with it: the device attribution, "`ppi` was dropped
> > from `config.yaml`" (it is ENABLED on the box), and above all *"the decoder has never run on real
> > bytes"* — it runs every night, on tens of thousands of frames.
> >
> > **The trap is worth keeping, because a sibling of it nearly landed the same conclusion twice.**
> > `writers.py` records that the box's earlier `_PPI.txt` layout put `hr` THIRD where PSL puts it LAST,
> > so a PSL-shaped reader took column 1 — our device clock — as the interval, failed the sanity band,
> > and read **21 871 real rows as zero usable beats**: *"the exact shape of 'the Verity's PPI is dead',
> > which is the conclusion this layout would have manufactured."* Same verdict, two independent causes,
> > neither of them the sensor.
> >
> > **The generalisable lesson:** the original note congratulates itself for reading *values* rather than
> > counting *files* — and that was the right instinct applied to the wrong denominator. It still never
> > asked **whose** files those were. A measurement of one producer cannot license a claim about the
> > device unless every other producer of the same stream agrees, and here a second producer was sitting
> > on the same disk disagreeing by four orders of magnitude.

- **V1 · GYRO / MAG decoders are new + only the DELTA path is exercised.** The Verity streams compressed
  (delta) frames, so `polar_pmd.decode_frame`'s uncompressed GYRO/MAG branches (`base==0`, int16 x/y/z) are
  UNTESTED, and even the delta path's **scaling/units are unconfirmed** (traces respond correctly to motion
  but were never byte-diffed). **Do:** capture a Verity `_GYRO`/`_MAG` via Polar Sensor Logger for the same
  motion and diff values + units (gyro dps, mag gauss).
- **V2 · ACC uncompressed frame-type is suspect.** `decode_frame` decodes uncompressed ACC as `base==1`
  while GYRO/MAG use `base==0`. No real uncompressed ACC frame has been seen (Verity is delta; H10 ACC was
  captured but not diffed). Confirm the H10 ACC bytes/units against a PSL `_ACC` export. (Pre-existing flag
  from FOLLOWUPS-I, still open.)
- ~~**V3 · PPI decoder is completely unexercised.**~~ **RESOLVED 2026-08-08 — see the overturn note above.**
  (As written: *"PPI is DEAD on this Verity unit (accepts START, streams 0 frames …), so `ppi` was dropped
  from `config.yaml`. The `PPI and base==0` decoder in `polar_pmd` therefore has never run on real bytes;
  kept for a possible OH1 / other device."*) Every clause of that is now false **for the box path**: `ppi`
  is enabled in the box's `config.yaml`, the decoder runs nightly, and the unit produced **30 151 PPI rows**
  on 2026-08-07 alone. The decoder is exercised on real bytes at scale; it is the **PSL** capture of PPI
  that yields nothing, and that is an app finding, not a device or decoder finding.
  - **Still genuinely open:** the decoder's *correctness* is not established by volume. The rows are
    plausible and the layout now matches PSL's column-for-column (`writers.py`), but no byte-diff against
    a vendor PPI export exists — because PSL never produced one to diff against. That is the same shape as
    V1/V2 and should be tracked as such, not as "unexercised".
- **V4 · Monotonic `_now()` re-anchor — OBSERVED ON HARDWARE 2026-08-04, though not by the trigger this
  item names.** The journal on the live box carries the re-anchor firing **twice**:
  `Jul 27 22:12:07 … INFO capture clock re-anchored to civil time (timezone set to America/New_York)` and
  again `Jul 29 20:57:17`. So the path is no longer "only unit-tested" — it runs, logs once per event, and
  the box kept capturing across both. ⚠️ **Both were TIMEZONE sets, not the NTP step V4 asks for**, so the
  original experiment (start with the clock deliberately wrong, let NTP step it) is still unrun. Partial,
  and recorded as partial.
- **V4-original · Monotonic `_now()` re-anchor untested vs a real NTP step.** Only unit-tested for normal advance +
  the DST edge (F2) reasoned, not observed. Exercise it: start capture with the clock deliberately wrong,
  let NTP step it, confirm the re-anchor log fires once and stamps stay sane after.
- **V5 · Clock apply path — the sudoers rule IS installed; the apply path is still unexercised, and the
  installed helper is STALE. Measured on the box 2026-08-04.**
  - The grant exists: `(root) NOPASSWD: /usr/local/lib/tepna/tepna-clock.sh` (plus `tepna-rssi.sh`,
    `tepna-restart.sh`, and `ip`/`wpa_supplicant`/`wpa_cli`). Note the path — `/usr/local/lib/tepna`, which
    is `helper_path.SYSTEM_DIRS[0]`, **not** the `/opt/tepna/capture-host/…` this item specifies.
  - **It has never written anything:** `/etc/systemd/timesyncd.conf.d/` does not exist, so the ntp/sync half
    of the helper has not run on this box. The timezone half evidently has (see V4).
  - 🔴 **The privileged copies have DRIFTED from the checkout, and the stale ones win.** `helper_path.resolve()`
    returns the first existing `SYSTEM_DIRS` entry, so `/usr/local/lib/tepna` is preferred over the in-repo
    copy. Measured md5s: `tepna-clock.sh` and `tepna-restart.sh` differ between the root-owned copy and the
    (repo-identical) checkout; `tepna-rssi.sh` matches; **`tepna-usbreset.sh` was never installed at all and
    has no sudoers grant** — which means the USB unbind/bind step `VIGIL-OVERNIGHT-FINDINGS` P1.3 calls
    *"the only reliable clear"* for a wedged adapter cannot run.
    - ✅ **THE DRIFT IS RESOLVED — re-measured on the box 2026-08-15.** All four managed helpers now match
      the checkout byte-for-byte:

      | helper | 2026-08-04 | 2026-08-15 |
      |---|---|---|
      | `tepna-clock.sh` | DRIFTED | **MATCH** |
      | `tepna-restart.sh` | DRIFTED | **MATCH** |
      | `tepna-rssi.sh` | match | **MATCH** |
      | `tepna-usbreset.sh` | **not installed** | **MATCH** |

      Closed by the owner running `sudo bash check-system-files.sh --install` on 2026-08-15, which
      re-installs the whole MANAGED set rather than the one file it was run for — so `tepna-usbreset.sh`
      arrived as a side effect, and P1.3's *"only reliable clear"* is now runnable.

      ⚠️ **The mechanism that produced the drift is unchanged**, so it will recur: a MANAGED helper fixed
      in the repo stays stale under `/usr/local/lib/tepna` until someone runs `--install` by hand. The
      hourly `tepna-update.timer` does **not** cover this class — it fast-forwards `/opt/tepna` only.
      That is the two-class distinction: **installed into `/etc` or `/usr/local/lib` ⇒ needs an operator;
      run from the checkout ⇒ the timer IS the deployment.** `check-system-files.sh` is itself the second
      class, which is why it needed no install to start reporting.

  - ❌ **The apply path is STILL unexercised — re-checked 2026-08-15, unchanged.**
    `/etc/systemd/timesyncd.conf.d/` is still absent, so the ntp/sync half of `tepna-clock.sh` has still
    never written anything. The drift being fixed does **not** close V5; it removes one of the two reasons
    V5 was open. What remains needs the apply path actually invoked on hardware.
    - ⚠️ **That last clause is WRONG, corrected 2026-08-05 — and it is the more interesting error.**
      `tepna-usbreset.sh` is **not** the unbind/bind rung. It toggles `authorized` on a docked **Polar
      sensor** to re-open the PS-FTP window and is hard-allowlisted to `0da4:0008`; its header names *"the
      very BLE adapters the capture depends on"* as what it must never reach. Installing it (done
      2026-08-04; grant verified passwordless 2026-08-05) did nothing for P1.3. The rung's actual blocker
      was code — `capture._usb_rebind` wrote root-only sysfs from an unprivileged daemon and logged the
      `PermissionError` at INFO as *"skipped"*. Fixed 2026-08-05 with a separate root helper
      `tepna-btreset.sh`, allowlisted by USB device **class** `e0:01:01` so it may touch only radios; the
      two allowlists are asserted disjoint. **The re-measurement that produced the finding was sound; the
      inference that one helper's name matched another's job was not** — two privileged helpers whose
      names differ by two letters do opposite things, and only reading both says so.
  - **Now gate-backed:** the four privileged helpers were absent from `deploy/check-system-files.sh`'s
    manifest, which is why this was invisible. They are on it as of 2026-08-04, with tests reproducing both
    halves (stale, and never-installed) and a non-vacuity check deriving the helper list from
    `enable-clock-control.sh` so the two cannot drift apart. **Owner action to fix the box:**
    `sudo bash /opt/tepna/capture-host/deploy/enable-clock-control.sh` (needs the password), then re-run
    `deploy/check-system-files.sh` to confirm 0 drifted.
- **V5-original · Clock apply path untested on hardware.** `tepna-clock.sh` (ntp/sync/tz) via `sudo -n` was only
  verified to **fail gracefully** without the sudoers rule. On a real box: add
  `tepna ALL=(root) NOPASSWD: /opt/tepna/capture-host/tepna-clock.sh`, then confirm the timesyncd drop-in
  writes, the service restarts, `timedatectl set-timezone` works, and the monitor reflects it.

## 3 · Durability / robustness
- **R1 · Buffered writes lose the tail on a crash — DONE (verified 2026-07-18).** Every writer class
  (`StreamWriter`, `Spo2CsvWriter`, `OxyFrameLogWriter`, `HostClockLogWriter`, `LinkLogWriter`) now flushes
  **and `os.fsync()`s** on a `FLUSH_INTERVAL_S = 5.0` cadence, so at most ~5 s of tail is ever at risk.
  Time-based, not every-N-rows, so a slow stream is bounded the same as a fast one.
- **R2 · Multiplexed SSE queue can drop under combined load.** `/api/stream/_all` feeds one bus subscriber
  queue (`maxsize 64`); with ECG 130 Hz + PPG 55 Hz×4ch + 3×IMU pushing together, bursts can evict oldest.
  Fine for a live view (disk is the record), but note it — don't ever read the monitor as the source of truth.

## 4 · Deferred features (own brief when picked up)
- **D1 · Clock provenance per night — DONE 2026-07-18** (`host_clock.py` + `HostClockLogWriter`, PR #220).
  `timedatectl show`/`show-timesync` is polled read-only and each night records what actually disciplined
  the box's clock (source, stratum, whether a reply was `Ignored`), so a self-consistently-wrong night is
  stamped absolute-time-unverified instead of silently inherited.
- **D2 · `offsetMin` in exports.** Clock Contract §1's optional `offsetMin` (real UTC offset when known)
  would enable true cross-timezone simultaneity — deliberately deferred here because it touches the export
  format; do it as a gated change if wanted.
- **D5 · Sharpen the PPG averaged-pulse** — *re-homed here 2026-08-04 from `CAPTURE-HOST-FOLLOWUPS`
  §4.2, which closed on the Done-when's "executed or re-homed" clause.* State verified in code the same
  day and unchanged since 2026-07-18: it is a two-pass foot-aligned ensemble with correlation rejection
  (`corr(w,avg) > 0.85` over the last 24 pulses, `monitor.html:2049`) plus a ±60 ms foot re-delineation
  (`:2060`). Better than the slope-detect it started as — but the alignment anchor is still the **foot**,
  which is precisely what the long-crest complaint was about (see the note at `:1998`).
  **Low priority, and the reason is measurable:** nothing computes a metric from it — a grep for any
  consumer of the averaged pulse returns none — so this is live-view cosmetics, not a number anyone
  reads. Pick it up only if the averaged pulse ever feeds something.
- **D3 · Monitor "lite" mode.** The Overview/scope do client-side beat/pulse detection; harmless off-box but
  it's Pi CPU if the box kiosk-displays its own monitor. A lite (traces-only) mode would keep the box light.
- **D4 · Multi-sensor DERIVATIONS agenda — promote to its own brief** (`MULTI-SENSOR-DERIVATIONS-BRIEF`).
  The newly-captured, Clock-Contract-synchronized streams unlock values the suite can't produce today, all
  computed in the **apps** (never on the box): **respiratory effort from the chest ACC → central-vs-obstructive
  apnea** (cross with O2Ring desats) and **body position → positional OSA** (chest ACC gravity vector) are the
  headline, differentiated ones; also **respiration rate** (fuse ACC + ECG-EDR + PPG-RIIV), **pulse transit
  time** (H10 R-peak → Verity PPG foot; `PAT Feasibility.html` already scoped it), **motion-gated /
  cross-validated HRV** (ACC-reject + ECG-RR vs PPG-PPI), and **actigraphic sleep/wake**. All land at
  experimental/emerging on the evidence ladder, not `validated`. Skip reflectance-SpO₂ from the green-dominant
  Verity LEDs (unreliable) and seismocardiography from the ACC (research-grade).

## 5 · State / housekeeping
- The **clock/NTP feature** (`capture.py clockcfg.py tepna-clock.sh webmon.py monitor.html` + gitignored
  `config.yaml`) was committed on `claude/vigil-capture-parity` alongside `645810d` (this session), and this
  brief + [`MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md`](MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md) with it.
- `claude/vigil-capture-parity` was **rebased onto `main`** this session (it was the pre-merge tip + `645810d`);
  still not pushed — a PR would branch from here. *(Superseded: all of it has since landed on `main`.)*
- Still open from FOLLOWUPS-I: **no real overnight round-trip**, **no real-Pi bring-up**. The
  `how-to-collect/` notes are **DONE** — `verity-ppg.md` and `health-box.md` exist; the O2Ring is covered
  by `oxydex-spo2.md` rather than a separate `o2ring-s.md`, which is why that filename never appeared.

> **Status corrected PROPOSED → IN-PROGRESS 2026-08-26.** The header had stayed PROPOSED while the
> body recorded the opposite: §1 *"ALL THREE EXECUTED 2026-07-18"*, §3 R1 **DONE (verified 2026-07-18)**,
> §4.2 closed on its own "executed or re-homed" clause, and §5's clock/NTP work *"has since landed on
> `main`"*. A brief whose first section is titled EXECUTED is not proposed. Nothing here is newly
> measured — the flip only makes the one-word status agree with the sentence below it, which has named
> the remaining work since 2026-07-18. Everything still open is hardware-gated, so the next honest move
> is a device session, not more reading.

**What remains before this brief can flip DONE (2026-07-18):** everything left is **hardware-gated** —
§2's V1–V5 all need a real device or a real box (a PSL `_GYRO`/`_MAG`/`_ACC` export to byte-diff against,
an OH1 for PPI, an observed NTP step, a box with the sudoers rule), plus the overnight round-trip and the
Pi bring-up. No further desk work is available here: §1 and R1 are closed and §4's D1 has shipped.

> **⚠️ THE PARAGRAPH ABOVE IS DATED 2026-07-18 AND HAS BEEN OVERTAKEN — read it as history, not status.**
> Its claim that *"no further desk work is available here"* was falsified within three weeks by work
> recorded in this very brief, above it: **V3 RESOLVED 2026-08-08** (30 151 real PPI rows — the decoder is
> exercised at scale, and it is PSL's *capture* that yields nothing, an app finding not a device one),
> **V1–V3 measured against the 19 GB PSL corpus 2026-08-04**, **V4 OBSERVED ON HARDWARE 2026-08-04**, and
> **V5's drift closed 2026-08-15**. Four items moved on desk evidence and a live box after the paragraph
> declared none could.
>
> **Current state of the V-items, 2026-08-15:**
>
> | | state | what is actually left |
> |---|---|---|
> | **V1** | partial | physical-invariant agreement shown (H10 ACC 996.2 vs 992.5 mg, 0.4 %); the **uncompressed** GYRO/MAG byte-diff is still owed |
> | **V2** | open | needs one real uncompressed H10 `_ACC` frame diffed against a PSL `_ACC` export |
> | **V3** | ✅ resolved | 2026-08-08; correctness-by-byte-diff re-tracked as V1/V2-shaped, not "unexercised" |
> | **V4** | ✅ observed | 2026-08-04, though not by the trigger the item specified |
> | **V5** | partial | drift ✅ closed 2026-08-15; the ntp/sync **apply path** is still unexercised (`timesyncd.conf.d` absent) |
>
> **The brief stays PROPOSED**, and the honest reason is narrower than the 2026-07-18 paragraph's: what is
> left is V1/V2's byte-diffs of the **uncompressed** path, V5's apply path, and the overnight round-trip +
> Pi bring-up. The 2026-08-04 PSL work compared *physical invariants*, not bytes, and explicitly did not
> close V1's uncompressed claim; whether the 19 GB corpus already contains a usable uncompressed frame or
> one must be captured is **not established here** — check before assuming either. **Do not re-derive "no
> desk work is available" from the old paragraph** — that sentence is what made three later sessions'
> findings look like they had nowhere to land.

## Related
- [`CAPTURE-HOST-2026-06-29-BRIEF.md`](CAPTURE-HOST-2026-06-29-BRIEF.md) — the parent (stays PROPOSED).
- [`CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md) — FOLLOWUPS-I (first bring-up).
- [`HEALTH-BOX-VISION-2026-07-01-BRIEF.md`](HEALTH-BOX-VISION-2026-07-01-BRIEF.md) — the Vigil product vision (§4 live-view).
- [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md) — SDK as the authoritative PMD decoder spec (relevant to V1/V2/V3).
