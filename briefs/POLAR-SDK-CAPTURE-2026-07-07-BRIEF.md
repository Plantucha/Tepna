<!--
  POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-07

# Polar BLE SDK as a capture foundation — hardening the daemon and the "capture companion" app option

> **What this is.** A research + architecture note evaluating the **official Polar BLE SDK**
> (`github.com/polarofficial/polar-ble-sdk`, surfaced via the intro repo
> `create-mobile-app-for-polar-sensors`) as a way to **improve raw-signal capture** for the suite.
> It **extends, does not relitigate**, `CAPTURE-HOST-2026-06-29-BRIEF.md` (the *how* — Pi/bleak
> daemon) and `HEALTH-BOX-VISION-2026-07-01-BRIEF.md` (the *what* — Tepna Vigil). Every hardware
> pick, parser rule, filename convention, and Clock-Contract detail stays owned there; this brief
> only asks **"what does the official SDK buy us that reverse-engineered `bleak` decode doesn't,
> and where should it land?"** Ships no code — it is a decision doc.

---

## 1 · What the linked repos actually provide

- **`create-mobile-app-for-polar-sensors`** is a one-page primer, not code. Its load-bearing fact:
  Polar sensors follow **standard BLE**, so **standard streams (HR, RR intervals) need no contract**
  and are readable by any generic BLE host. But **proprietary streams excluded from the SIG profiles
  — raw ECG, accelerometer (and on optical devices, PPG) — are reachable only via the Polar BLE
  SDK's PMD (Polar Measurement Data) service.** It also documents H10's operating logic (below, §5).
- **`polar-ble-sdk`** is the official, maintained SDK (BSD-3-Clause) for **Android (minSdk 24, Kotlin
  + RxJava3) and iOS (Swift + RxSwift)**. It exposes: online streaming of **ECG · ACC · PPG · PPI ·
  gyro · magnetometer · HR**, **SDK mode** (unlocks device-specific sample rates/ranges), **offline
  recording** control (start/stop/list/fetch the H10's & Verity's *onboard* recordings), feature
  discovery, and Battery/Device-Info reads — all decoded by Polar's own frame parser, including the
  **compressed (delta-encoded) ECG/ACC frames**.

**The gap it closes.** Today's capture-host daemon (`capture-host/polar_pmd.py`) **reverse-engineers
those same PMD frames in Python** and its own scaffold header flags the soft spots: "ECG full,
**ACC/PPG + compressed-frame caveats**." The SDK is the **authoritative reference** for exactly the
frame formats where the hand-rolled decoder is weakest.

---

## 2 · The core constraint (why this isn't a drop-in)

The SDK is **native Android/iOS only — there is no Linux/Python build.** The Tepna health box is a
Raspberry Pi running `bleak` on BlueZ (`CAPTURE-HOST §5/§6`). So the SDK cannot be linked into the
Pi daemon. That splits the opportunity into **two independent, non-exclusive tracks**, evaluated in
§3 and §4. Whichever track(s) we take, the **integration contract in `CAPTURE-HOST §7` is
non-negotiable and unchanged**: emit the *existing* vendor file layouts, Clock-Contract timestamps,
and device-id filenames so files route with **zero new parser branch**.

---

## 3 · Track A — use the SDK as a *reference spec* to harden the Pi daemon (low-risk, recommended first)

Keep the architecture exactly as `CAPTURE-HOST` specifies (Pi + `bleak` + dongle bedside). **Read the
SDK's open-source PMD parser as the ground-truth documentation** for the frame formats and
**reimplement the weak paths** in `polar_pmd.py` from it:

- **Compressed ECG/ACC delta frames** — the caveat the scaffold names. The SDK's decode (reference
  sample size, delta bit-width, sample-count fields) is the spec; port the algorithm, not the code.
- **PPG/ACC frame typing** on Verity — align channel/scale handling to the SDK's field definitions.
- **Sample-rate / resolution settings** the PMD control point accepts, so the daemon requests the
  same H10 130 Hz ECG / Verity PPG settings the SDK would.

**Why first:** it is the cheapest, contract-preserving win — no new device, no new toolchain, no new
adapter. It directly retires the `polar_pmd.py` caveats and improves the fidelity of the **mandatory
live ECG stream** (`CAPTURE-HOST §3`). BSD-3 is Apache-2.0-compatible; a reimplemented-from-spec
`polar_pmd.py` stays Apache-2.0 under our SPDX header — **do not copy SDK source verbatim**; lift the
algorithm/constants and cite the SDK as the reference in a code comment.

**New capability worth pulling in even on the Pi track:** the SDK documents the **offline-recording
control** commands. If those are within reach of the PMD control point over `bleak`, the daemon could
**start/stop/fetch the H10 & Verity onboard recordings programmatically** — upgrading
`CAPTURE-HOST §2`'s "onboard recording = reliability backstop" from a *manual button press* to an
**automated morning fetch**. This is the single most valuable idea the SDK surfaces for our
unattended-overnight use case; capture it as a follow-up experiment (§6).

---

## 4 · Track B — a native SDK "capture companion" app (the Android-app option you asked about)

Instead of (or beside) the Pi, run capture on a **spare Android phone/tablet at the bedside**, built
on the Polar BLE SDK. This is the "different Android app" idea — and it can be framed two ways:

- **B1 · Capture-only companion (recommended framing).** A minimal Android app whose ONLY job is:
  connect the worn Polar devices → stream ECG/PPG/ACC (and/or fetch offline recordings) → write files
  in the **exact PSL vendor layouts** (`*_ECG.txt`, `*_PPG`, `*_ACC`, `*_HR`), with **Clock-Contract
  timestamps** and **device-id filenames** (`<Vendor>_<Model>_<DeviceId>_<YYYYMMDDHHMMSS>_<STREAM>`),
  then drop them into the night store (share to the Pi over LAN, or the phone *is* the store). It is a
  **cleaner replacement for the third-party Polar Sensor Logger** (`CLAUDE.md §🎙️`) — official decode,
  our filenames, no reverse-engineering — and it changes **nothing** downstream: files still route
  through the existing adapters.
- **B2 · Companion *as* the health box.** The phone plays the capture + (served) web-app roles the Pi
  plays, if someone prefers a no-hardware setup. This is a bigger product call and overlaps
  `HEALTH-BOX-VISION`; treat B1 as the near-term deliverable and B2 as a vision variant.

**What Track B buys over Track A:** official decode *for free* (no port), SDK mode, first-class
offline-recording fetch, and a live on-device view — using hardware most people already own. **What
it costs:** a native Android build + toolchain (out-of-suite, like the Pi daemon), Android BLE
background-execution limits to fight for overnight reliability, and a second capture codebase to
maintain. The Pi's dedicated bedside dongle-on-an-extension (`CAPTURE-HOST §5`) is still the stronger
answer to the body-attenuation reliability risk; a phone left on the nightstand is more convenient
but a weaker radio position.

**Hard rules if we build Track B (same posture as the whole suite):**
1. **Emit existing vendor layouts + Clock Contract + device-id filenames** — no new parser branch
   (`CAPTURE-HOST §7.1–7.3`). If a stream genuinely can't mimic an existing layout, land it as a new
   adapter per `docs/ADD-AN-ADAPTER.md` + a `how-to-collect/` note — never edit a shared parser.
2. **Zero network egress.** The app captures and writes files locally; it does **not** phone home. The
   "100 % local, no CDN" rule applies to any producer we ship.
3. **No new persistent identifiers.** Use the Polar device-id for companion pairing only; never stamp
   a subject ID or hardware serial into exports (`EXPORT-IDENTITY-2026-06-27-BRIEF §`).
4. **SPDX + Apache-2.0** header on all authored source; the SDK is a build dependency (BSD-3), record
   it in `THIRD-PARTY.md` / SOUP if it ever enters a shipped artifact.

---

## 5 · Capture-robustness facts from the H10 primer (apply on either track)

The intro repo documents H10 behavior the capturer must respect:

- **Skin-contact gating.** H10 only advertises once it detects skin contact, and **terminates the BLE
  connection after ~20–30 s of no skin contact** to save power. The daemon/app must treat this
  auto-disconnect as **expected**, not an error — reconnect on skin-contact-resume, and record the gap
  as a **gap** (Clock-Contract: missing stamps stay `null`, never fabricated).
- **HR = 1 Hz uint8**; **RR intervals are in units of 1/1024 s** (convert to ms explicitly, don't
  assume ms). H10 supports RR but **not** energy-expenditure in the HR characteristic.
- Standard services present: **HRS, BAS (battery, with change indication), DIS, UDS** — battery/DIS
  reads feed the `status.json` surface (`CAPTURE-HOST §8`).

---

## 6 · Recommendation & open questions

**Recommendation.** Take **Track A first** — it is contract-preserving, needs no new device, and
directly retires the `polar_pmd.py` compressed-frame caveats on the mandatory ECG stream. Prototype
the **automated offline-recording fetch** (§3) as the high-value experiment. Treat **Track B1** (the
capture-only Android companion) as a strong *optional* second producer / cleaner-than-PSL path, gated
by the §4 rules; defer **B2** to the `HEALTH-BOX-VISION` product track.

**Open questions (human calls):**
- Is offline-recording control reachable over `bleak`/PMD, or only via the SDK? (Decides whether the
  automated-fetch backstop is a Track-A win or a Track-B-only feature.)
- Do we want a second, native producer at all, or keep the fleet to one Pi daemon + PSL fallback?
- Where would Track-B code live — a sibling project (like the out-of-suite `capture-host/` daemon),
  never in the bundled-app gate path.
- Verity: live PMD PPG vs offline fetch (the SDK makes offline fetch easy) — revisits
  `CAPTURE-HOST §10`'s open Verity question.

**Done when.** This is a decision doc; it flips to DONE when a human picks Track A / B1 / both (or
neither) and any accepted work opens its own dated build brief. Follow-ups →
`POLAR-SDK-CAPTURE-FOLLOWUPS-YYYY-MM-DD-BRIEF.md`.

---

## Cross-references
- `CAPTURE-HOST-2026-06-29-BRIEF.md` — the Pi/bleak capture architecture this hardens (owns the *how*; `polar_pmd.py`, §7 integration contract, §2 backstop, §5 dongle).
- `HEALTH-BOX-VISION-2026-07-01-BRIEF.md` — Tepna Vigil product vision (the B2 framing sits here).
- `CLAUDE.md` §🎙️ Capture provenance (Polar Sensor Logger — the third-party tool Track B1 would replace) · §🔒 Clock Contract.
- `docs/ADD-AN-ADAPTER.md` — the new-vendor path if a stream can't mimic an existing layout.
- `EXPORT-IDENTITY-2026-06-27-BRIEF.md` — why no device serial / subject ID enters exports.
- `ECG-RPEAK-SEED-FIX-2026-06-27-BRIEF.md` — the real PSL `*_ECG.txt` shape + startup-transient any live capturer reproduces.
- Upstream: `github.com/polarofficial/polar-ble-sdk` (BSD-3) · `github.com/polarofficial/create-mobile-app-for-polar-sensors` (primer).
