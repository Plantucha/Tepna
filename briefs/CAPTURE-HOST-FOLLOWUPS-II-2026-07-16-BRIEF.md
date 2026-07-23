<!--
  CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-16 (**Field-verified 2026-07-22 on `rig-x870`:** the whole
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
- **V1 · GYRO / MAG decoders are new + only the DELTA path is exercised.** The Verity streams compressed
  (delta) frames, so `polar_pmd.decode_frame`'s uncompressed GYRO/MAG branches (`base==0`, int16 x/y/z) are
  UNTESTED, and even the delta path's **scaling/units are unconfirmed** (traces respond correctly to motion
  but were never byte-diffed). **Do:** capture a Verity `_GYRO`/`_MAG` via Polar Sensor Logger for the same
  motion and diff values + units (gyro dps, mag gauss).
- **V2 · ACC uncompressed frame-type is suspect.** `decode_frame` decodes uncompressed ACC as `base==1`
  while GYRO/MAG use `base==0`. No real uncompressed ACC frame has been seen (Verity is delta; H10 ACC was
  captured but not diffed). Confirm the H10 ACC bytes/units against a PSL `_ACC` export. (Pre-existing flag
  from FOLLOWUPS-I, still open.)
- **V3 · PPI decoder is completely unexercised.** PPI is DEAD on this Verity unit (accepts START, streams 0
  frames — confirmed PPI-only + on-skin + clean START; the reference PSL app never got it either), so `ppi`
  was dropped from `config.yaml`. The `PPI and base==0` decoder in `polar_pmd` therefore has **never run on
  real bytes**; kept for a possible OH1 / other device. Validate there before trusting it.
- **V4 · Monotonic `_now()` re-anchor untested vs a real NTP step.** Only unit-tested for normal advance +
  the DST edge (F2) reasoned, not observed. Exercise it: start capture with the clock deliberately wrong,
  let NTP step it, confirm the re-anchor log fires once and stamps stay sane after.
- **V5 · Clock apply path untested on hardware.** `tepna-clock.sh` (ntp/sync/tz) via `sudo -n` was only
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

**What remains before this brief can flip DONE (2026-07-18):** everything left is **hardware-gated** —
§2's V1–V5 all need a real device or a real box (a PSL `_GYRO`/`_MAG`/`_ACC` export to byte-diff against,
an OH1 for PPI, an observed NTP step, a box with the sudoers rule), plus the overnight round-trip and the
Pi bring-up. No further desk work is available here: §1 and R1 are closed and §4's D1 has shipped.

## Related
- [`CAPTURE-HOST-2026-06-29-BRIEF.md`](CAPTURE-HOST-2026-06-29-BRIEF.md) — the parent (stays PROPOSED).
- [`CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md) — FOLLOWUPS-I (first bring-up).
- [`HEALTH-BOX-VISION-2026-07-01-BRIEF.md`](HEALTH-BOX-VISION-2026-07-01-BRIEF.md) — the Vigil product vision (§4 live-view).
- [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md) — SDK as the authoritative PMD decoder spec (relevant to V1/V2/V3).
