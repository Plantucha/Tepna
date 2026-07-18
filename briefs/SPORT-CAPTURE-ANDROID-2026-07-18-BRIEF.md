<!--
  SPORT-CAPTURE-ANDROID-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-18 · **Extends:** `POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md` (Track B1) · **Related:** `CAPTURE-HOST-2026-06-29-BRIEF.md` (the bedside sibling — owns the *how*), `MOTIONDEX-BUILD-2026-07-17-BRIEF.md` (a downstream consumer), `AMBULATORY-MODE-BRIEF.md` (why "a walk isn't a sleep")

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
2. **Emit existing vendor layouts + device-id filenames → no new parser branch**
   (`CAPTURE-HOST §7`, `writers.py`). Filenames are
   `<Vendor>_<Model>_<DeviceId>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>`; one device-id per physical sensor so
   the suite's companion-pairing (`signal-orchestrate.js pairCompanions`, device-id + nearest stamp)
   works and a Verity `_ACC` never cross-pairs onto an H10 `_ECG`. The `timestamp [ms]` column is
   **relative-to-first-sample AND fractional** — never rounded (ECGDex infers `fs` from its step; the
   ~10 % HR bug in `CAPTURE-HOST-FOLLOWUPS-2026-07-16 §1` was exactly this).
3. **Zero network egress.** The app captures and writes files **locally**; it does not phone home, no
   cloud sync, no analytics, no CDN. "100 % local" applies to any producer we ship
   (`POLAR-SDK-CAPTURE §4 rule 2`). GPS/route data (new here, §3) makes this *stricter*, not looser.
4. **No new persistent identifiers.** Use the Polar/O2Ring device-id for pairing only; never stamp a
   subject ID or hardware serial into exports (`EXPORT-IDENTITY-2026-06-27-BRIEF`).
5. **SPDX + Apache-2.0** on every authored source file. The Polar BLE SDK is a **build dependency
   (BSD-3-Clause, Apache-2.0-compatible)** — record it in `THIRD-PARTY.md` and the `docs/COMPLIANCE/`
   SOUP list if it enters a shipped artifact. Do **not** copy SDK source verbatim into any file that
   carries our SPDX header.
6. **Compute lives in the Dex apps, never on the capturer** (`MULTI-SENSOR-DERIVATIONS §0`). The app
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
| Decode path | Reverse-engineered PMD in Python (`polar_pmd.py`, has caveats) | **Official Polar BLE SDK** — authoritative decode, SDK mode, offline fetch |
| Connectivity | LAN, served apps at `http://tepna.local` | Off-network in the field; the **phone is the store** |
| Reliability enemy | BlueZ wedge, skin-contact drops | Android **Doze / background-execution limits**, battery, thermal |

Two consequences fall out of this table and shape the whole design:

- **The Polar BLE SDK is native Android/iOS only** (`POLAR-SDK-CAPTURE §2`). On the phone there is **no
  reverse-engineering tax** — the SDK gives official ECG/ACC/PPG/PPI/gyro/mag decode (including the
  compressed/delta frames `polar_pmd.py` flags as its weakest paths), SDK mode, and first-class
  offline-recording fetch **for free**. This is the single biggest reason the sport host is a *better*
  place to be than the Pi for Polar hardware, and it directly retires the daemon's decode caveats for
  anything captured here.
- **Motion is signal, not noise, but it is still not ours to analyse on the box.** Sport wants
  cadence, pace, HR-zone feedback, effort — but those are Dex-node outputs (ECGDex ambulatory mode
  already emits `activity:{steps, briskPct, …}`; MotionDex is scoped for actigraphy/position). The app
  captures the IMU + GPS RAW and leaves the counts to the apps. See §5.

---

## 2 · Platform & foundation

- **Native Android, Kotlin.** minSdk 24 (the Polar SDK floor); target a current API level for the
  foreground-service + storage rules. Kotlin + coroutines (or RxJava3 as the SDK ships) — the SDK is
  Kotlin/RxJava3 on Android.
- **Foundation: the official Polar BLE SDK** (`github.com/polarofficial/polar-ble-sdk`, BSD-3-Clause).
  Use it for Polar H10 / Verity Sense: online streaming (ECG · ACC · PPG · PPI · gyro · mag · HR),
  **SDK mode** (device-specific rates/ranges), **offline-recording** start/stop/list/fetch, feature
  discovery, Battery/DIS reads. This is Track B1 of `POLAR-SDK-CAPTURE` made real.
- **Non-Polar sensors reuse the reverse-engineered protocols already proven in `capture-host/`, ported
  to Android BLE** — the byte-level work is done and hardware-validated; only the transport changes
  (Android `BluetoothGatt` / the SDK's generic BLE, not BlueZ/bleak):
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
- **iOS is explicitly out of scope** for this brief (the SDK supports it; a second platform is a later
  call). One platform, shipped and validated, first.

---

## 3 · Signals captured — the sport signal set

Every stream is written RAW in its existing PSL layout (§4). Rates are the SDK/device defaults the
capture-host already requests; SDK mode can unlock higher ones where a downstream node benefits.

**Inherited streams (existing PSL layouts — no new adapter):**

| Sensor | Stream(s) | Rate / shape | Notes |
|---|---|---|---|
| Polar H10 | `_ECG` (14-bit) · `_ACC` (chest, mg) · `_HR`/RR | ECG 130 Hz · ACC 200 Hz (or SDK-mode) · HR 1 Hz, RR 1/1024 s | ECG is the honest-HR leg. RR in 1/1024 s → convert to ms explicitly. |
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

```
ecg:  Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]
acc:  Phone timestamp;sensor timestamp [ns];timestamp [ms];X [mg];Y [mg];Z [mg]
ppg:  Phone timestamp;sensor timestamp [ns];timestamp [ms];ppg0;ppg1;ppg2;ambient
hr:   Phone timestamp;sensor timestamp [ns];HR [bpm];RR-interval [ms]
gyro: Phone timestamp;sensor timestamp [ns];timestamp [ms];X [dps];Y [dps];Z [dps]
mag:  Phone timestamp;sensor timestamp [ns];timestamp [ms];X [G];Y [G];Z [G]
```
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
- **BLE robustness** — the SDK handles reconnection, but the sport envelope adds body-attenuation
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
- **Offline-recording fetch as a backstop** — the SDK makes it first-class. If a live BLE link drops
  during a bout, the H10/Verity **onboard recording** (started via SDK) is the reliability net; fetch
  it on session-stop and reconcile. This is the sport analogue of the bedside "morning fetch" idea and
  the strongest argument for the SDK over generic BLE here.

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
  clock the Clock Contract mandates.

---

## 9 · Privacy & licensing

- **Zero network egress** (§0.3) — reinforced by GPS: nothing leaves the phone without an explicit
  user share. No analytics SDKs, no crash-reporting-to-cloud, no map/tile fetch.
- **No persistent identifiers in exports** (§0.4, `EXPORT-IDENTITY`).
- **SPDX / Apache-2.0** on all authored source; **Polar BLE SDK = BSD-3 build dependency** →
  `THIRD-PARTY.md` + `docs/COMPLIANCE/` SOUP entry if shipped. Do not vendor SDK source into
  SPDX-headered files.
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

1. **Phase 0 — skeleton + one stream.** Gradle project `capture-android/`, foreground service, Polar
   SDK wired, **H10 ECG only** → PSL `_ECG.txt` to app storage. Validate the **parity harness** (§12):
   byte-diff vs a PSL export, `fs=130`, `0.0` first ms, gap-honest across a deliberate skin-contact
   drop. This proves the Clock-Contract + filename + fractional-ms contract on Android before anything
   else is added.
2. **Phase 1 — full Polar streams.** Add H10 ACC + RR, Verity PPG (4-ch) + ACC/GYRO/MAG. SDK mode
   exposed. Multi-device concurrent capture. Confirm each routes into ECGDex/PpgDex/(MotionDex-input)
   with no new parser branch.
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
- **O2Ring in scope for sport?** (Finger site + unsynced clock; nice-to-have, not core — Phase 3 is
  optional.)
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
hardware. The brief flips to **DONE** when the capture host reliably produces routable, Clock-Contract-
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
- `docs/ADD-AN-ADAPTER.md` — the sanctioned path for the new sport-native streams (GPS/baro/phone-IMU).
- `CLAUDE.md` §🎙️ Capture provenance · §🔒 Clock Contract · §📜 Licensing — law; wins on conflict.
- Upstream: `github.com/polarofficial/polar-ble-sdk` (BSD-3) · `create-mobile-app-for-polar-sensors`
  (H10 operating-logic primer).
