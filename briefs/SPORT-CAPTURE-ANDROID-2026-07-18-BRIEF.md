<!--
  SPORT-CAPTURE-ANDROID-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED (parked 2026-09-02 — drain triage, Kestrel: an Android capture app is a NEW LANE — §14 requires the owner's explicit greenlight, no fleet session owns an Android toolchain, and no unit of it is startable from the repo. Owner: the owner (greenlight or decline); next step: none until then. Untouched since creation) · **Created:** 2026-07-18 · **Extends:** `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md` (Track B1) · **Related:** `CAPTURE-HOST-2026-06-29-BRIEF.md` (the bedside sibling — owns the *how*), `MOTIONDEX-BUILD-2026-07-17-BRIEF.md` (a downstream consumer), `AMBULATORY-MODE-BRIEF.md` (why "a walk isn't a sleep")

# Sport Capture Host — a native Android capture companion for on-body, in-motion recording

> **What this is.** A build proposal for a **native Android app whose only job is to CAPTURE** the
> Tepna raw signals **during sport / activity** — worn or carried on the body, in motion, away from
> the bedside — and drop **exactly the existing Polar-Sensor-Logger vendor file layouts** into the
> local store so they route into the Dex apps **with zero new parser branch**. It is the **daytime,
> in-motion sibling** of the bedside `capture-host/` Raspberry-Pi daemon
> (`CAPTURE-HOST-2026-06-29-BRIEF.md`), and it is the concrete execution of the **Track B1** option
> that `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md §4` left as an open human call. It **extends, does not
> relitigate** those two briefs: every Clock-Contract rule, filename convention, integration
> contract, privacy invariant, and "compute lives in the apps, never on the capturer" split stays
> owned there and is inherited verbatim here. `CLAUDE.md` is law and wins on every conflict.
>
> **This brief ships no code today.** It is PROPOSED — it flips to IN-PROGRESS when a human greenlights
> a native Android build track, and the phased build (§11) then lands under its own gates (§12).

---

## 0 · Identity & invariants (inherit, do not re-derive)

The sport capture host is a **producer**, exactly like `capture-host/`. It is **out-of-suite**: it is
NOT a Dex node, NOT bundled by `tools/build.mjs`, NOT covered by `Dex-Test-Suite.html` /
`verify-provenance.html` / `BUILD-MANIFEST.json`. It obeys these inherited invariants and nothing new:

1. **Clock Contract (§🔒, non-negotiable).** Every sample stamp is **zone-free local-civil wall time
   → floating `tMs`** (`Date.UTC(components-as-written)`). The written `Phone timestamp` column is the
   zone-free local-civil ISO ms string (`%Y-%m-%dT%H:%M:%S.mmm`) the PSL layout uses. Never a raw
   epoch as primary, never `new Date(str)` on a vendor string, and **a dropped/absent stamp is a gap
   (stop writing rows), never a fabricated `now()`**. A capturer that free-runs across a phone
   NTP/DST step must re-anchor on a monotonic clock and log the step — the direct Android analogue of
   `capture.py`'s `_now()` monotonic anchor.
2. **Discipline the DEVICE clocks, not just the phone's — this is the app's reason to exist.**
   `capture-host` sets each Polar sensor's clock over PS-FTP `SET_LOCAL_TIME`
   (`polar_psftp.set_local_time` — LOCAL civil time, per the Clock Contract) on **every connect**,
   re-reads the skew every `time.drift_check_sec`, and re-syncs on a JUMP (`capture.py
   clock_watchdog`). Polar stamps every sample with *device* time, and an unset H10 falls back to its
   2019-01-01 firmware default whenever it leaves the strap — so without this the sensors share no
   origin. **Measured 2026-07-31 (PR #601) from the raw accelerometers:** phone-captured (PSL) nights
   put H10 and Verity **1.8–5.0 s apart, median 3.3 s, not one inside 1 s**; vigil-box nights
   **0.10–0.39 s**. PSL does not set device clocks; the box does. **That gap is the entire delta
   between this app and a PSL export** — file-layout parity (invariant 3) buys nothing the suite does
   not already have for free.
   - Set both Polar clocks on **every** connect, not once per session: the H10 drops the link on
     skin-contact loss mid-bout, which §7 already treats as expected.
   - Re-anchor each reconnect fragment to the phone clock and log the applied skew. A **constant**
     offset is recorded once and left alone; a **jump** triggers a re-sync. Do not chase a fixed
     offset — that is `clock_watchdog`'s documented lesson, and the Verity's +4 h PMD stamp is the
     known example of an offset no amount of re-syncing moves.
   - **The anchor itself.** The phone clock is NTP-disciplined at ms level, already an order of
     magnitude inside the ≤ 0.5 s bar in §12. A **GNSS** anchor is a legitimate upgrade — the receiver
     is on anyway for the §4 `.gpx` track — but only via `GnssClock` raw measurements with the
     `leapSecond` correction applied; NMEA UTC is ~1 s, and `System.currentTimeMillis()` is not
     GNSS-disciplined at all. **Never step the system clock** (it needs root and would break every
     monotonic anchor) — carry an offset. Mishandling the 18 s GPS↔UTC leap correction is exactly the
     silently-plausible-but-wrong instant that §🔒.7 exists to reject.
   - **Record the provenance; never fabricate it.** Write a per-session clock sidecar naming what
     disciplined the phone (`gnss` / `ntp` / `none`) and the per-sensor sync outcome — the Android
     analogue of `host_clock.classify`'s `disciplined | holdover | unknown` ladder and the
     `Tepna_*_CLOCK.csv` sidecar. An untrusted anchor must **not** stop the device sync (a
     common-but-wrong base still beats a 2019 default); it must be **stamped**.
3. **Emit existing vendor layouts + device-id filenames → no new parser branch**
   (`CAPTURE-HOST §7`, `writers.py`). Filenames are
   `<Vendor>_<Model>_<DeviceId>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>`; one device-id per physical sensor so
   the suite's companion-pairing (`signal-orchestrate.js pairCompanions`, device-id + nearest stamp)
   works and a Verity `_ACC` never cross-pairs onto an H10 `_ECG`. The `timestamp [ms]` column is
   **relative-to-first-sample AND fractional** — never rounded (ECGDex infers `fs` from its step; the
   ~10 % HR bug in `CAPTURE-HOST-FOLLOWUPS-2026-07-16 §1` was exactly this).
4. **Zero network egress.** The app captures and writes files **locally**; it does not phone home, no
   cloud sync, no analytics, no CDN. "100 % local" applies to any producer we ship
   (`POLAR-SDK-CAPTURE §4 rule 2`). GPS/route data (new here, §3) makes this *stricter*, not looser.
5. **No new persistent identifiers.** Use the Polar/O2Ring device-id for pairing only; never stamp a
   subject ID or hardware serial into exports (`EXPORT-IDENTITY-2026-06-27-BRIEF`).
6. **SPDX + Apache-2.0** on every authored source file. ⚠️ **The Polar BLE SDK is PROPRIETARY, not
   BSD-3** — corrected 2026-08-01 against the upstream repo: `spdx_id: NOASSERTION`, licence file
   `Polar_SDK_License.txt`, GitHub classification "Other". Its terms: use/copy/modify permitted **only
   with Polar's copyright and licence notice retained**; redistribution limited to *object code bundled
   with your app, for the purpose of moving data between a Polar device and that app* (§3.1);
   commercial use permitted; attribution on the product required (§4.3); and an explicit field-of-use
   denial — **"not intended to be used in life critical, life supporting or medical purpose"** (§3.2).
   It is **not copyleft**: taking it would not push our own code off Apache-2.0. If it ever enters a
   shipped artifact it needs a `THIRD-PARTY.md` row, a `docs/COMPLIANCE/` SOUP entry, and the notices
   above. Do **not** copy SDK source verbatim into any file that carries our SPDX header — and see §9
   for the attribution the *existing* `capture-host/` protocol modules already owe.
7. **Compute lives in the Dex apps, never on the capturer** (`MULTI-SENSOR-DERIVATIONS §0`). The app
   captures RAW and may *display* a live monitor (§5), but it computes **no analysis metric** that a
   Dex node owns. The files it writes are the deliverable; the analysis happens later in
   ECGDex/PpgDex/HRVDex/MotionDex.

---

## 1 · Why sport is a distinct problem (the delta from the bedside host)

The bedside `capture-host/` and this app share the integration contract and most of the protocol
work, but the **operating envelope is different enough that a phone, not a Pi, is the right host** for
sport — and different enough that a naïve port of the daemon would be wrong.

| Axis | Bedside host (`capture-host/`) | Sport capture host (this brief) |
|---|---|---|
| Host | Fixed Raspberry Pi + USB dongle on an extension, bedside | The user's **phone**, on-body / in a pocket / on an armband |
| Radio position | Dedicated dongle, strong static link | Phone radio, moving, body-attenuated, variable |
| Session | Unattended **overnight**, ~8 h, systemd `Restart=always` | User-started **bouts** (minutes–hours), explicit start/stop, foreground service |
| Dominant signal concern | Quiet, low-motion; artifact is the exception | **Motion is the point** — IMU/ACC is first-class, not a sidecar |
| New signals | none (ECG/PPG/SpO₂/IMU) | **GPS track, barometric altitude, phone IMU, cadence/pace** |
| Decode path | Own PMD + PS-FTP in Python (`polar_pmd.py` / `polar_psftp.py`; delta frames unhandled) | **The same protocol work ported to Kotlin** over raw `BluetoothGatt` — the SDK is a fallback, not the foundation (§2) |
| Connectivity | LAN, served apps at `http://tepna.local` | Off-network in the field; the **phone is the store** |
| Reliability enemy | BlueZ wedge, skin-contact drops | Android **Doze / background-execution limits**, battery, thermal |

Two consequences fall out of this table and shape the whole design:

- **The Polar BLE SDK is available on the phone and not on the Pi** (`POLAR-SDK-CAPTURE §2`) — but the
  reverse-engineering tax it would buy off has **already been paid**, in this repo, under Apache-2.0.
  `polar_pmd.py` decodes ECG/ACC/PPG/PPI/gyro/mag; `polar_psftp.py` lists **and pulls** the onboard
  offline recordings over PS-FTP (RFC60/RFC76). Both are hardware-validated. Porting our own modules to
  Kotlin is a translation, not a reimplementation. **Decision (2026-08-01): we do not take the SDK
  unless something forces us to.** It is proprietary (§0.6) and it is not needed for the capture path.
  - **The one genuine gap** is the compressed/**delta** PMD frame types (`frame_type >= 1` for ACC/PPG),
    which `polar_pmd.py` explicitly refuses to guess at and defers to the SDK's decoder. That is bounded,
    well-specified decoding work — the *only* thing that would reopen the SDK question. Establish early
    (Phase 0) which frame types your firmware actually emits; if it is uncompressed throughout, the
    question never arises.
  - **SDK mode** (device-specific rates/ranges) and connection management are conveniences, not
    blockers; the daemon negotiates settings today via PMD control op `0x01`.
- **Motion is signal, not noise, but it is still not ours to analyse on the box.** Sport wants
  cadence, pace, HR-zone feedback, effort — but those are Dex-node outputs (ECGDex ambulatory mode
  already emits `activity:{steps, briskPct, …}`; MotionDex is scoped for actigraphy/position). The app
  captures the IMU + GPS RAW and leaves the counts to the apps. See §5.

---

## 2 · Platform & foundation

- **Native Android, Kotlin + coroutines.** minSdk 24 — no longer "the Polar SDK floor" (the SDK is out,
  §1) but still the right floor: it is where `GnssClock` raw measurements arrive, which §0.2 wants for
  the optional GNSS anchor. Target a current API level for the foreground-service + storage rules.
  Coroutines throughout; there is no RxJava3 dependency to inherit now.
- **Foundation: our own protocol modules, ported — NOT the Polar SDK** (decided 2026-08-01, see §1).
  `polar_pmd.py` (PMD service: control point, ECG · ACC · PPG · PPI · gyro · mag) and `polar_psftp.py`
  (PS-FTP over RFC60/RFC76: list + fetch onboard offline recordings) are Apache-2.0 and
  hardware-validated; port them to Kotlin over raw `BluetoothGatt`. This keeps the Android app free of
  a proprietary dependency and its notice/field-of-use obligations (§0.6, §9). The SDK is reconsidered
  **only** if compressed/delta PMD frame decoding proves intractable — nothing else in the capture path
  needs it. This is still Track B1 of `POLAR-SDK-CAPTURE` made real; only the decode foundation changed.
- **All sensors reuse the protocols already proven in `capture-host/`, ported to Android BLE** — the
  byte-level work is done and hardware-validated; only the transport changes (Android `BluetoothGatt`,
  not BlueZ/bleak):
  - **Polar H10 / Verity Sense** (`polar_pmd.py` + `polar_psftp.py` + `bonding.py` → Kotlin): PMD
    service `FB005C80` (control `…81`, data `…82`) — `GET_SETTINGS 0x01` / `START 0x02` / `STOP 0x03`,
    the per-type frame decoders, and the status-code table incl. the "no answer is not a rejection"
    rule; PS-FTP `FB005C51` for offline-recording list + GET; and `SET_LOCAL_TIME` for the clock
    discipline §0.2 makes mandatory. Bonding first — Polar gates PS-FTP behind an encrypted link.
  - **O2Ring-S / T8520 "OxyII"** (`oxyii.py` → Kotlin): the 0xA5/CRC-8 framing, auth `0xFF` → setup
    `0x10` → poll `0x04`, `SET_UTC_TIME 0xC0`, and the validated **live ~125 Hz finger-PPG body**
    (`parse_ppg`) + stored `.dat` transfer (`0xF1–0xF4`). Reference: `O2RING-PROTOCOL-2026-07-17-BRIEF.md`
    (REFERENCE) + `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`.
  - **Phone-native sensors** via the Android SensorManager + FusedLocation: GPS, barometer, phone
    accelerometer/gyro (§3).
- **Where it lives.** A **new out-of-suite sibling directory**, e.g. `capture-android/` (a Gradle
  project), analogous to `capture-host/` — **never in the bundled-app gate path**
  (`POLAR-SDK-CAPTURE §6`). It gets its **own CI** (Gradle build + unit tests + ktlint), path-filtered
  like `.github/workflows/capture-host-ci.yml` runs only on `capture-host/**`. The JS gates are
  untouched. (Monorepo, not a split repo — same reasoning as the capture-host CI decision: the
  vendor-file-format + Clock-Contract producer/consumer coupling wants atomic same-repo PRs.)
- **iOS is explicitly out of scope** for this brief (a second platform is a later call — and one that
  would re-raise the SDK question on its own terms). One platform, shipped and validated, first.

---

## 3 · Signals captured — the sport signal set

Every stream is written RAW in its existing PSL layout (§4). Rates are the device defaults the
capture-host already requests over PMD control op `0x01`; the device's extended ("SDK") mode can unlock
higher ones where a downstream node benefits — that is a **device** capability negotiated on the
control point, not something the Polar SDK is required for (§2).

**Inherited streams (existing PSL layouts — no new adapter):**

| Sensor | Stream(s) | Rate / shape | Notes |
|---|---|---|---|
| Polar H10 | `_ECG` (14-bit) · `_ACC` (chest, mg) · `_HR`/RR | ECG 130 Hz · ACC 200 Hz (or extended-mode) · HR 1 Hz, RR 1/1024 s | ECG is the honest-HR leg. RR in 1/1024 s → convert to ms explicitly. |
| Polar Verity Sense | `_PPG` (4-ch: 3 LED + ambient) · `_ACC` (wrist) · `_GYRO` · `_MAGN` · `_PPI` | PPG 55 Hz · ACC/GYRO 52 Hz · MAG 50 Hz | PPI is often empty on this unit — derive HR from raw PPG, not `_PPI`. |
| Wellue O2Ring-S (optional) | `_SpO2` CSV · finger `_PPG` (~125 Hz) | 1 Hz SpO₂/PR · 125 Hz pleth | Finger site; ring clock is unsynced (`SET_UTC_TIME` fixes it, else back-time from arrival). |

**New sport streams (phone-native — need a decision, §4):**

| Source | Data | Why sport needs it |
|---|---|---|
| GPS (FusedLocation) | lat/lon/altitude/speed/accuracy per fix (1 Hz typ.) | Route, distance, pace, elevation gain — the core outdoor-sport signal |
| Barometer | pressure → relative altitude | Elevation/climb where GPS altitude is noisy; stair/hill detection |
| Phone IMU | accelerometer + gyro (SensorManager) | Cadence/steps, a second motion source independent of the chest strap |

The three phone-native streams have **no existing Dex consumer today** — GPS/pace/route is new ground
for the suite. They are captured RAW to disk; wiring a consumer (a future SportDex, or MotionDex/
Integrator ingestion) is out of scope for THIS brief (§6, §10).

---

## 4 · Output contract

**Inherited streams:** write the **byte-identical PSL vendor layouts** `writers.py` already emits, so
they route with **zero new parser branch**:

⚠️ **Corrected 2026-08-01 (audit F4) — the block below now matches `writers.StreamWriter.HEADERS`
verbatim, verified against real corpus files.** It previously carried a `timestamp [ms]` column on
**acc/gyro/mag** that neither Polar Sensor Logger nor the box emits, named the PPG columns `ppg0/1/2`
instead of `channel 0/1/2`, and merged HR and RR into one file that PSL splits into two. An implementer
following it would have written a 6-column ACC file into parsers that expect 5 — every axis shifted one
column left, reading the sensor-ns column as X. Do not re-derive this table by hand: it is
`writers.HEADERS`, and that is the source of truth.

```
ecg:  Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]
acc:  Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]
ppg:  Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient
ppg1: Phone timestamp;sensor timestamp [ns];channel 0          ← single-optical-path sites (see below)
hr:   Phone timestamp;HR [bpm];HRV [ms];Breathing interval [rpm];
rr:   Phone timestamp;RR-interval [ms]
gyro: Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]
mag:  Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]
ppi:  Phone timestamp;sensor timestamp [ns];HR [bpm];PP-interval [ms];error estimate [ms];blocker;skin contact;skin contact supported
```

Three consequences that are easy to get wrong and expensive to find later:

- **`timestamp [ms]` exists on ECG only.** It is relative-to-first-sample and **fractional** — emitting
  it integer or absolute made ECGDex infer `fs=143` instead of 130, a silent ~10 % HR error.
- **HR and RR are two files.** PSL writes `_HR.txt` (HR only; the HRV/Breathing columns exist in the
  header and stay empty) and a sibling `_RR.txt` for the per-beat intervals. `PulseDex.parseRRInput` and
  ECGDex's `_RR` routing both expect the split.
- **A single-photodiode site uses `ppg1`, never `ppg` with the value replicated.** Fanning one optical
  path across three channels is what let PpgDex's consensus vote report a fabricated `ledAgreementPct:
  100` at `measured` tier (AUDIT-PROMPT class 11). The header and the row shape share one stream key so
  they cannot drift apart.
plus the ViHealth SpO₂ CSV `Time,Oxygen Level,Pulse Rate,Motion` with `%H:%M:%S %d/%m/%Y` stamps for
the O2Ring. Same filename convention. Same fractional un-rounded `timestamp [ms]`. Same per-frame
host-arrival back-timing. **A capture parity harness (the Android analogue of
`tests/ecg_parity_harness.py`) is a gate (§12):** capture ~30 s of H10 ECG on the phone, and a
byte-diff against a Polar-Sensor-Logger export of the same window must match; `parseECGText` must infer
`fs = 130`, first `timestamp [ms]` = `0.0`, 0 spurious gaps.

**New sport streams:** GPS / barometer / phone-IMU **cannot mimic an existing PSL layout**, so they
land through the sanctioned new-vendor path — **`docs/ADD-AN-ADAPTER.md` + a `how-to-collect/` note**,
**never by editing a shared parser** (`POLAR-SDK-CAPTURE §4 rule 1`). Recommended near-term: write GPS
as a **standard `.gpx`** track (interoperable, tool-agnostic) alongside the session, and phone-IMU in
the same PSL `_ACC`/`_GYRO` layout tagged with the phone as the device-id. These files sit in the
session folder for a future consumer; they do **not** block the inherited-stream deliverable.

**Session packaging + the cross-node currency.** A sport session is one folder
`captures/<session>/` holding all per-stream files (the same shape OverDex/`dex-ingest.js` routes). If
the app emits a Ganglior summary at all, it uses the frozen contract: `schema.name:"ganglior.node-export"`,
`recording.startEpochMs` = floating `t0Ms`, `ganglior_events:[{t, tMs, impulse, node, conf, meta}]`,
PHI-scrubbed. But **the primary deliverable is the raw files** — the Ganglior export is a node's job,
not the capturer's, and is optional here.

---

## 5 · The real-time question (resolve the batch-vs-live tension up front)

Sport users expect live feedback (current HR, zone, pace). The suite's firm split is **"compute lives
in the apps, never on the box"** (`MULTI-SENSOR-DERIVATIONS §0`). These are reconcilable, and the
resolution is the same one the bedside host already uses:

- **The app is a CAPTURE surface with an optional thin LIVE MONITOR**, exactly like the Pi's
  `monitor.html` + `webmon.py` SSE/telemetry layer — it *displays* live waveforms and the device's own
  scalar readouts (HR from the standard HR characteristic, SpO₂/PR from the O2Ring, a live scope),
  which are **device-reported or trivially-derived values, not Dex-node analysis**. The H10 already
  reports HR at 1 Hz; showing it live is monitoring, not analysis.
- **It computes no metric a Dex node owns.** No HRV summary, no R-peak-derived HR analysis, no
  actigraphy counts, no ambulatory-mode classification, no zone model beyond a trivial device-HR band.
  Those are ECGDex / HRVDex / PpgDex / MotionDex outputs, produced later from the raw files. This is
  the line that keeps the capturer honest and the analysis reproducible/gated.
- Precedent for the boundary: the recent `capture-host` commit **`d18f6a3 fix(capture-host): drop the
  H10-ACC breathing estimate from the live monitor`** deliberately removed a *derived* value from the
  monitor — a derived respiration estimate belongs in an IMU node, not the capture box. The sport
  monitor inherits that discipline: **raw + device-reported only**.

If, later, real-time coaching is wanted as a *product*, that is a deliberate, separately-briefed
decision to run a Dex compute path on-device — not something this capture host smuggles in.

---

## 6 · Consumer nodes — where the sport files go

The whole value is that captured files feed the **existing** analysis fleet with no new plumbing:

- **ECGDex** — H10 `_ECG` (+ `_ACC` companion). It **already has an ambulatory / activity-aware layer**
  (`ecgdex-dsp.js`: `accEx.gait`, `activityScore`, `mode:"ambulatory"`, `activity:{steps, briskPct,
  cadencePresentPct, accWakePct}`) built precisely so it does not mis-score a moving session as a sleep
  study (`AMBULATORY-MODE-BRIEF.md` — the live 2026-06-13 walk-scored-as-sleep failure). Sport captures
  are the **native input** to that mode. This is the strongest existing landing spot.
- **PpgDex** — Verity `_PPG` (+ `_ACC`/`_GYRO`/`_MAGN` companions); O2Ring finger `_PPG`. Motion-artifact
  handling is its known daytime challenge.
- **HRVDex** — RR/PPI-derived HRV summaries from the strap.
- **MotionDex** (PROPOSED, `MOTIONDEX-BUILD-2026-07-17-BRIEF.md`) — the not-yet-built IMU node that
  will finally give the chest/wrist `_ACC`/`_GYRO`/`_MAGN` a consumer (position, **actigraphy/activity
  counts**, effort, SQI). Sport capture is a major source of its input; this brief and MotionDex are
  mutually reinforcing but independent.
- **A dedicated cardio-fitness / training-load / VO₂ / GPS-pace "SportDex" node does NOT exist and is
  explicitly OUT of scope here** (§10). This brief delivers the *capture*; whether the suite grows a
  sport-analysis node is a separate product call, and GPS/pace has no consumer until it does.

---

## 7 · Android reliability — the systemd/watchdog analogue

The Pi gets `Restart=always` + `adapter_watchdog`. The phone's equivalent problem is the OS actively
throttling a long-running background app. A capture session that silently dies mid-run is the sport
version of a lost overnight:

- **Foreground service with an ongoing notification** for the whole session (Android requires it for
  continuous BLE + location). The notification is the session's "recording" indicator and stop control.
- **Doze / App-Standby / background-execution limits** are the enemy `CAPTURE-HOST-FOLLOWUPS` never
  faced. Hold a partial wake lock for the session; request battery-optimisation exemption; validate the
  screen-off, pocketed, long-run case explicitly (this is where Android silently kills capture).
- **BLE robustness** — reconnection is now ours to own (§2), and the sport envelope adds body-attenuation
  dropouts and **H10 skin-contact gating** (it drops the link after ~20–30 s of no skin contact and
  advertises only on contact — `POLAR-SDK-CAPTURE §5`). Treat that auto-disconnect as **expected**:
  reconnect on contact-resume, and record the gap **as a gap** (Clock Contract — never fabricate rows
  across it).
- **Storage** — scoped storage / app-private dir; the **phone is the store**. Provide an explicit
  **export/share** path (Share sheet, USB/MTP, or LAN drop to the Pi store) to get the session folder
  onto the machine that runs the served Dex apps. No auto-cloud.
- **Session lifecycle** — explicit start (arm devices, negotiate settings, begin files) and stop
  (flush + fsync + close, like `writers.py`'s `FLUSH_INTERVAL_S` auto-flush so a crash/kill bounds the
  at-risk tail). A crash mid-session must leave a valid, gap-honest partial folder.
- **Offline-recording fetch as a backstop.** If a live BLE link drops during a bout, the H10/Verity
  **onboard recording** is the reliability net; fetch it on session-stop and reconcile. This is the
  sport analogue of the bedside "morning fetch". ⚠️ **Corrected 2026-08-01:** this used to be listed as
  "the strongest argument for the SDK over generic BLE" — it is not an argument for the SDK at all.
  `capture-host/polar_psftp.py` already lists and pulls those recordings over PS-FTP, on real hardware,
  under Apache-2.0. Port it (§2). What the SDK adds here is *starting/stopping* a recording remotely,
  which a button press and a session-stop fetch cover.

---

## 8 · Sport-specific capture concerns (apply during build)

- **Motion artifact is expected, not an error.** Capture RAW; do not filter/gate on the box. Artifact
  flagging is a downstream node concern (MotionDex SQI, PpgDex).
- **SDK mode sample rates.** SDK mode unlocks device-specific rates (e.g. higher ACC) that a motion
  node may want; expose it as a per-session setting, defaulting to the capture-host defaults so files
  stay drop-in compatible.
- **Two independent motion sources** (chest H10 ACC + phone IMU) are a feature — device-id tagging
  keeps them from cross-pairing, and a future node can cross-validate them.
- **GPS + barometer sensitivity.** GPS is location data — the strictest zero-egress case in the suite.
  It never leaves the device except by the user's explicit export. No map tiles fetched (no CDN); if a
  route preview is shown, render the polyline locally with no network map.
- **Clock across a run.** A long outdoor bout can cross a network-time correction; the monotonic
  re-anchor (§0.1) must hold, and GPS time must not be silently substituted for the local-civil wall
  clock the Clock Contract mandates. A **GNSS-disciplined anchor** (§0.2) is compatible with that and
  is the point: GNSS may set *what the anchor believes the time is*, after the leap-second correction;
  the bytes written to disk stay zone-free local civil.

---

## 9 · Privacy & licensing

- **Zero network egress** (§0.4) — reinforced by GPS: nothing leaves the phone without an explicit
  user share. No analytics SDKs, no crash-reporting-to-cloud, no map/tile fetch.
- **No persistent identifiers in exports** (§0.5, `EXPORT-IDENTITY`).
- **SPDX / Apache-2.0** on all authored source. **The Polar BLE SDK is proprietary, not BSD-3** (§0.6)
  — and as of the §2 decision it is **not a dependency at all**, so no `THIRD-PARTY.md` row or SOUP
  entry is owed for it unless that decision is reversed.
- **Attribution the existing protocol modules already owe (open, found 2026-08-01).** This is a
  `capture-host/` debt, surfaced here because the port inherits it. `polar_psftp.py`'s header states the
  protocol is *"verbatim from the official Polar BLE SDK (BlePsFtpUtils.kt / pftp_request.proto)"* and
  `polar_pmd.py` cites the SDK's PMD spec — i.e. **derived by reading Polar's source, not clean-room**,
  while carrying only Tepna's SPDX header. Polar's licence permits use and modification *provided its
  copyright and licence notice is retained* (§3.1) and requires product attribution (§4.3). Two things
  are owed, and neither is a code change: (1) reword those headers to describe **the wire format** —
  the framing, the characteristics, the protobuf field numbers — rather than naming the file they were
  read from; a protocol is a fact and reimplementing one for interoperability is well-established, but
  "verbatim from `BlePsFtpUtils.kt`" describes a copy; (2) add a Polar row to `THIRD-PARTY.md` recording
  the protocol provenance. The GPL clean-room discipline the format-contract brief applies to
  `open-polar-h10-ecg-logger` was never applied to the SDK, because its terms were an open question
  until now.
- **Intended-use / non-device disclaimer** carries onto any user-facing surface, same as the apps
  (`CLAUDE.md §📜`, `docs/COMPLIANCE/` is 62304/13485-*aligned*, not conformant).

---

## 10 · Non-goals (what NOT to build)

1. **Not a Dex analysis node.** No on-device HRV/R-peak/actigraphy/zone analysis (§5). Compute stays
   in the apps.
2. **No SportDex / VO₂ / training-load / pace-analysis node** — this brief is the *capture* layer only.
   A sport-analysis node is a separate future proposal that would consume these files.
3. **No cloud, no account, no sync, no networked maps.** Ever (§9).
4. **No iOS** in this brief (§2).
5. **No new shared-parser edits.** New streams go through `ADD-AN-ADAPTER.md`, not by touching a
   `*-dsp.js` shared path (§4).
6. **No verbatim SDK source** under our SPDX header (§9).
7. **No replacement of the bedside host.** This is the daytime sibling; the Pi remains the answer for
   unattended overnight capture (`HEALTH-BOX-VISION`). They share the file contract, not the hardware.

---

## 11 · Suggested build order (phased)

Each phase is independently useful and independently validatable on real hardware.

1. **Phase 0 — skeleton + one stream.** Gradle project `capture-android/`, foreground service,
   `polar_pmd.py` ported to Kotlin over raw `BluetoothGatt` (§2), **H10 ECG only** → PSL `_ECG.txt` to
   app storage. **Record which PMD frame types the firmware actually emits** — uncompressed throughout
   retires the delta-decoder question (§1) before it can shape the design. Validate the **parity harness** (§12):
   byte-diff vs a PSL export, `fs=130`, `0.0` first ms, gap-honest across a deliberate skin-contact
   drop. This proves the Clock-Contract + filename + fractional-ms contract on Android before anything
   else is added.
2. **Phase 1 — full Polar streams + device-clock discipline.** Add H10 ACC + RR, Verity PPG (4-ch) +
   ACC/GYRO/MAG. SDK mode exposed. Multi-device concurrent capture. Confirm each routes into
   ECGDex/PpgDex/(MotionDex-input) with no new parser branch. **Implement §0.2 here** — `SET_LOCAL_TIME`
   to both Polars on every connect, per-fragment re-anchor, skew logged, clock-provenance sidecar
   written — and clear the cross-device agreement gate (§12). Adding a second sensor without this is
   the phase that produces a PSL clone: the file layout is the easy half, the shared origin is the
   half that justifies the build.
3. **Phase 2 — reliability.** Wake lock, battery-exemption, Doze survival on a real long screen-off
   pocketed run; flush/fsync tail-bounding; crash-leaves-valid-partial; **offline-recording fetch on
   stop** as the backstop.
4. **Phase 3 — O2Ring (optional).** Port `oxyii` (live SpO₂/PR + 125 Hz finger PPG + `SET_UTC_TIME`) to
   Android BLE; write the ViHealth SpO₂ CSV + PSL `_PPG`.
5. **Phase 4 — sport-native streams.** GPS `.gpx` + barometer + phone IMU, via `ADD-AN-ADAPTER.md`
   (raw capture only, no consumer node required to land).
6. **Phase 5 — live monitor (optional, thin).** Local live scope + device-reported scalars (§5), the
   `monitor.html` discipline: raw + device-reported only, no derived analysis.
7. **Phase 6 — export/share + how-to-collect.** Session export to the Dex-app store; a
   `how-to-collect/sport-android.md` operator note; a `SPORT-CAPTURE-ANDROID-FOLLOWUPS-…-BRIEF.md`
   capturing what real field use surfaces.

---

## 12 · Gates & verification

This is **out-of-suite** — the JS gates (`Dex-Test-Suite.html`, `verify-provenance.html`,
`BUILD-MANIFEST.json`) **do not and should not** cover it, exactly as they don't cover `capture-host/`.
Its own bar:

- **Capture-parity harness** (blocking, the Android `ecg_parity_harness.py` analogue): decode → write →
  re-parse; a real-hardware ~30 s H10 ECG window byte-diffs against a Polar-Sensor-Logger export of the
  same window; `parseECGText` infers `fs=130`, first `timestamp [ms]` = `0.0`, no spurious gaps.
- **Cross-device clock agreement** (blocking — the acceptance test for §0.2, and the one number that
  says whether this app beat PSL): capture one real session with H10 **and** Verity both worn, then
  `node tools/wearable-sync.mjs --src <session> --night <date> --fs 4 --json <ledger>`. The measured
  H10↔Verity offset must land **≤ 0.5 s** — inside the vigil box's 0.10–0.39 s band, not PSL's
  1.8–5.0 s (median 3.3 s). A session the tool cannot resolve is **excluded, never defaulted to zero**
  (PR #601's own rule). Re-run it whenever the connect/reconnect path changes: this regresses silently,
  because every file still parses and every stream still looks healthy.
- **Clock-provenance sidecar present and honest** — names `gnss`/`ntp`/`none` for the phone anchor and
  a per-sensor sync outcome, with no fabricated value when the state is unreadable (`unknown` is a
  legal, expected answer — `host_clock.classify`'s rule).
- **Clock-Contract verification** (the §🔒 checklist): first/last written rows match wall time;
  re-render under a changed device TZ → identical clock (floating `tMs` invariance); overnight/long
  run monotonic, no 24 h jump; a deliberate disconnect leaves a **gap**, not fabricated rows.
- **Routing check:** drop a captured session into the served **OverDex** → each file routes to the
  expected node and computes a `ganglior.node-export`; H10 `_ACC` sidecar pairs to its ECG primary and
  does **not** cross-pair onto a Verity stream.
- **Android CI** (path-filtered `capture-android/**`, sibling of `capture-host-ci.yml`): Gradle
  assemble + JVM unit tests (the pure decode/writer/clock logic — no BLE hardware needed, same as the
  bleak-free capture-host modules) + ktlint. No egress-introducing dependency (the `no-network` posture
  applies to producers too).
- **On-hardware validation** before trusting a session (the `README.md` "scaffold, unverified on
  hardware" discipline): real H10 + Verity + a pocketed long run.

---

## 13 · Open questions (human calls)

- **Greenlight a native Android build track at all?** (This is the Track-B1 decision
  `POLAR-SDK-CAPTURE §6` left open — now scoped for sport.) If yes, this flips to IN-PROGRESS and
  Phase 0 opens.
- ~~**Polar SDK or our own protocol modules?**~~ **RESOLVED 2026-08-01: our own** (§2). The SDK is
  proprietary with notice + field-of-use obligations (§0.6), and the capture path does not need it —
  PMD decode and PS-FTP offline fetch are already ours. Reopens only if compressed/delta PMD frames
  prove intractable.
- **Monorepo or a separate repo? — the two briefs disagree, and this needs a call.** §2 here says
  `capture-android/` as an out-of-suite sibling *in this repo* ("Monorepo, not a split repo"), while
  `ANDROID-CAPTURE-FORMAT-CONTRACT` §1 assumes "a separate Android capture app in its own repo under
  its own licence". The SDK decision above removes the *licence* reason to split — with no proprietary
  dependency the app can simply be Apache-2.0 — so what remains is a pure toolchain/ecosystem call
  (Gradle + Play Store cadence vs atomic same-repo PRs on the vendor-format coupling). Whichever wins,
  the losing brief's paragraph must be corrected, not left to drift.
- **Anchor the phone clock to GNSS, or trust network time?** `GnssClock` raw measurements (+ the
  `leapSecond` correction) give a checkable reference and the receiver is already on for the §4 `.gpx`
  track; NTP alone already clears the §12 ≤ 0.5 s bar, so this is an accuracy/provenance upgrade, not
  the fix. Either way the provenance is recorded (§0.2). Note the ranking: a perfect anchor that is
  never written to the sensors changes nothing — **distributing** the anchor is what closes the 3.3 s
  gap, not sharpening it.
- **O2Ring in scope for sport?** (Finger site; nice-to-have, not core — Phase 3 is optional. Its clock
  *is* settable: OxyII `SET_UTC_TIME`, already ported in `capture-host/oxyii.py`, so if it lands it
  falls under §0.2 like the Polars.)
- **Do the sport-native streams (GPS/baro/phone-IMU) get a consumer node now, or capture-only until a
  SportDex/MotionDex ingests them?** (This brief assumes capture-only.)
- **iOS ever?** (Out of scope here; the SDK supports it.)
- **Live monitor: ship it, or capture-only v1?** (Phase 5 is optional.)
- **Session export mechanism** — Share sheet vs USB/MTP vs LAN drop to the Pi store.

---

## 14 · Done-when

This is a proposal; it flips to **IN-PROGRESS** when a human greenlights the Android track, and each
phase (§11) flips its own acceptance. **Phase 0 is done when:** a native Android app captures real H10
ECG to a PSL `_ECG.txt`, the file passes the capture-parity harness (byte-diff vs PSL, `fs=130`, `0.0`
first ms, gap-honest), and the file opens in `ECGDex.html` yielding R-peaks + a sane HR — all on real
hardware. **Phase 1 is done when** that holds for every Polar stream concurrently **and** the §12
cross-device agreement gate passes on real hardware (H10↔Verity ≤ 0.5 s, `wearable-sync.mjs`-measured)
with the clock-provenance sidecar written: a phone capture that does not discipline the sensor clocks
is a PSL clone and does not justify the build. The brief flips to **DONE** when the capture host reliably produces routable, Clock-Contract-
correct sport sessions validated end-to-end into the Dex apps, with the Android CI green and a
`how-to-collect/sport-android.md` written. Follow-ups →
`SPORT-CAPTURE-ANDROID-FOLLOWUPS-YYYY-MM-DD-BRIEF.md`.

---

## References & cross-references

- `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md` — the decision doc this executes (Track B1 = the Android
  capture companion; §4 rules, §5 H10 primer, §6 open questions).
- `CAPTURE-HOST-2026-06-29-BRIEF.md` — the bedside Pi sibling; owns the *how* (`capture-host/`,
  `writers.py`, the §7 integration contract, filename convention, Clock-Contract producer rules).
- `CAPTURE-HOST-FOLLOWUPS-2026-07-16-BRIEF.md` / `-II-` — multi-stream bring-up + the fractional-`ms`
  correctness bug (§1) any capturer must reproduce.
- `MOTIONDEX-BUILD-2026-07-17-BRIEF.md` — the IMU consumer node; sport capture is a primary input.
- `MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md` — the "compute in the apps, never on the box" split
  and the derivations these signals feed (via the Integrator).
- `AMBULATORY-MODE-BRIEF.md` — ECGDex's activity-aware mode; the existing landing spot for a moving
  session (the walk-scored-as-sleep failure).
- `O2RING-PROTOCOL-2026-07-17-BRIEF.md` (REFERENCE) · `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md` —
  the OxyII protocol + live finger-PPG this would port to Android.
- `EXPORT-IDENTITY-2026-06-27-BRIEF.md` — no subject-id/serial in exports.
- `ANDROID-CAPTURE-FORMAT-CONTRACT-2026-07-26-BRIEF.md` (REFERENCE) — the file-level interface a phone
  must write. Complementary: it owns the *bytes*, §0.2 here owns the *shared origin* behind them.
- `docs/papers/wearable-clock-drift.html` · `tools/wearable-sync.mjs` — the measurement behind §0.2
  (PR #601, 2026-07-31): H10↔Verity 1.8–5.0 s on phone capture vs 0.10–0.39 s on the vigil box, and the
  tool that measures it per session.
- `docs/ADD-AN-ADAPTER.md` — the sanctioned path for the new sport-native streams (GPS/baro/phone-IMU).
- `CLAUDE.md` §🎙️ Capture provenance · §🔒 Clock Contract · §📜 Licensing — law; wins on conflict.
- Upstream: `github.com/polarofficial/polar-ble-sdk` — **`NOASSERTION` / `Polar_SDK_License.txt`,
  proprietary** (verified 2026-08-01; the earlier "BSD-3" in this brief was wrong) ·
  `create-mobile-app-for-polar-sensors` (H10 operating-logic primer).
- `capture-host/polar_pmd.py` · `capture-host/polar_psftp.py` · `capture-host/bonding.py` ·
  `capture-host/oxyii.py` — the Apache-2.0 protocol work this port translates, and the reason §2 needs
  no SDK.
