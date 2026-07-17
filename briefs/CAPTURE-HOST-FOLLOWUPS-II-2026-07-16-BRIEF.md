<!--
  CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-16

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

## 1 · Correctness / bugs to fix
- **F1 · Empty-vendor writer artifact — FIXED this session.** A remembered/hot-spawned device with a blank
  `vendor`/`model` produced `__AC028496_<ts>_ECG.txt` (0 bytes) — `guessDevice()` in `monitor.html` falls
  through to empty vendor/model + a device_id derived from the MAC, and `run_polar`/`capture_filename` opened
  a writer anyway. **Fixed:** `capture.py` `_spawn` now refuses (logs + sets `last_error`) any device missing
  `name`/`vendor`/`model`/`device_id`. Optional follow-up: also require them in the monitor's Remember flow.
- **F2 · DST re-anchor is non-monotonic.** `capture.py` `_now()` re-anchors on any wall-vs-monotonic step
  > `_STEP_THRESH_S` (2 s). A **DST fall-back** (civil clock goes back 1 h) is a −3600 s step → it re-anchors
  to `actual`, so a night crossing 02:00 local on the fall-back date would run **backward** and fail the
  Clock Contract's "overnight monotonic" check. Rare + logged, but decide: special-case DST (ignore a step
  that equals a whole-hour civil shift and keep counting monotonically), or accept + document.
- **F3 · `incoming_subdir` is vestigial.** `config.yaml` sets `incoming_subdir: captures/incoming` but
  `writers.night_dir()` writes straight to `captures/<YYYY-MM-DD>/` and ignores it. Either wire the
  incoming→dated roller (the `CAPTURE-HOST` design's night-roller) or drop the key so it doesn't imply a
  behavior that isn't there.

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
- **R1 · Buffered writes lose the tail on a crash.** ECG/PPG/IMU writers buffer ~1 MB, `Spo2CsvWriter`
  ~64 KB. A real overnight should flush every N rows / T seconds. (Spo2 flush was already on FOLLOWUPS-I;
  now it's all the Polar streams too, at higher volume — ACC alone was ~25 MB/session.)
- **R2 · Multiplexed SSE queue can drop under combined load.** `/api/stream/_all` feeds one bus subscriber
  queue (`maxsize 64`); with ECG 130 Hz + PPG 55 Hz×4ch + 3×IMU pushing together, bursts can evict oldest.
  Fine for a live view (disk is the record), but note it — don't ever read the monitor as the source of truth.

## 4 · Deferred features (own brief when picked up)
- **D1 · Clock provenance per night.** Record NTP-synced-state + `offsetMin` at session start into
  `status.json` / the night object, so each night's absolute-time trustworthiness is known after the fact.
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
  still not pushed — a PR would branch from here.
- Still open from FOLLOWUPS-I: no real overnight round-trip, no `how-to-collect/` notes
  (`verity-ppg.md` / `o2ring-s.md` / `health-box.md`), no real-Pi bring-up.

## Related
- [`CAPTURE-HOST-2026-06-29-BRIEF.md`](CAPTURE-HOST-2026-06-29-BRIEF.md) — the parent (stays PROPOSED).
- [`CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md) — FOLLOWUPS-I (first bring-up).
- [`HEALTH-BOX-VISION-2026-07-01-BRIEF.md`](HEALTH-BOX-VISION-2026-07-01-BRIEF.md) — the Vigil product vision (§4 live-view).
- [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md) — SDK as the authoritative PMD decoder spec (relevant to V1/V2/V3).
