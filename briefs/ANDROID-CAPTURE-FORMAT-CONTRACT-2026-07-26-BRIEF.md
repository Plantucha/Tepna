<!--
  ANDROID-CAPTURE-FORMAT-CONTRACT-2026-07-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living) · **Created:** 2026-07-26

# The Android capture contract — what a phone must write for Tepna to read it

> **What this is.** The interface between Tepna and a **separate Android capture app in its own repo
> under its own licence**. It is deliberately not an API and not a shared library: **the contract is the
> FILES**. Get these right and a recording made on a phone is indistinguishable from one made by the
> Vigil box, and routes through the existing adapters with **no new parser branch** (`CAPTURE-HOST §7`).
> **Why it exists.** Two repos that share a format and nothing else will drift unless the format is
> written down once. This is that document — the companion to `ADD-AN-ADAPTER.md`, which covers adding a
> *new* layout; this one covers matching an *existing* one exactly.
> **Scope:** out-of-suite. No bundle / `manifestHash` / provenance impact.

---

## 0. The one-paragraph version

Tepna already parses **Polar Sensor Logger** output — the committed corpus *is* PSL files, and
`dex-ingest.js` matches its naming by explicit regex. So the Android app does not need Tepna's code, and
Tepna does not need the app's: it needs the app to write **PSL-named files with zone-free local civil
timestamps**, plus the **ViHealth CSV layout** for the ring. Everything else — SDKs, languages, licences,
UI — is the other repo's business.

---

## 1. Why a separate repo (and what may cross)

| | |
|---|---|
| **Tepna** | Apache-2.0 |
| **Android app** | its own repo, its own licence |
| **Polar BLE SDK** | [`polarofficial/polar-ble-sdk`](https://github.com/polarofficial/polar-ble-sdk) — **`NOASSERTION`**, i.e. Polar's own terms, not a standard OSS licence. Read them before depending on it. Active (pushed 2026-07-02), 708★ |
| **Polar Sensor Logger** | **closed source.** A Google Play app by Jukka Happonen (Polar Electro Research Centre). There is no repo to fork — and none is needed, because what we depend on is its *format*, not its code |
| [`lrq3000/open-polar-h10-ecg-logger`](https://github.com/lrq3000/open-polar-h10-ecg-logger) | **GPL-3.0**, last pushed 2020-12. ⚠️ **Do not read it.** Same call as `engzee_ecg_detector` in the detector work — GPL means clean-room, and a clean room stops being clean the moment someone looks. It is also five years stale against a 2026 SDK |

**What may cross freely:** Tepna's own Apache-2.0 code. `oxyii.py` in particular — the OxyII protocol is
ours and porting it to Kotlin is unencumbered. That is the piece with real value in it (§4).

**What must never cross:** source in either direction. If the app ever needs Tepna logic beyond a port
of our own files, that is a signal the contract below is missing something — fix the contract, not the
boundary.

---

## 2. Polar files — the PSL layout

**Filename** — parsed by explicit regex at `dex-ingest.js:35`, and emitted by `writers.capture_filename`
on the box today:

```
Polar_<MODEL>_<DEVICEID>_<YYYYMMDD>_<HHMMSS>_<KIND>.txt
Polar_H10_02849638_20260725_225058_ECG.txt
```

- `<KIND>` ∈ `ECG` `ACC` `PPG` `PPI` `HR` `GYRO` `MAG` — one file per signal, per session
- `<DEVICEID>` is the device's own serial, **not** a MAC and not a nickname. `writers.file_device_id`
  recovers it by stepping back over `HHMMSS` onto `YYYYMMDD`; a name that breaks that shape returns
  `None` and the file is **unattributed**, which `IDENTITY_FIELDS` treats as orphaned, not as a warning.
- The **split stamp** (`_YYYYMMDD_HHMMSS_`) is load-bearing. A single `YYYYMMDDHHMMSS` token also parses,
  but the split form is what PSL writes and what the corpus contains — emit the split form.

**Rows** — the PSL column layout, `;`-separated, with `Phone timestamp` first. The box's `StreamWriter`
already emits exactly this; mirror it rather than inventing a variant.

⚠️ **`timestamp [ms]` is RELATIVE and FRACTIONAL, not absolute.** Emitting it integer+absolute is a real
bug that shipped once: ECGDex inferred **fs=143 instead of 130**, a silent ~10 % HR error
(`CAPTURE-HOST-FOLLOWUPS-2026-07-16`).

---

## 3. 🔒 The Clock Contract — the clause that silently breaks everything

**Write zone-free LOCAL CIVIL time. Never an epoch. Never a zoned instant.**

```
2026-07-25T22:50:58.123      ✅ what PSL writes, what the parser expects
1785019858123                ❌ epoch ms — viewer-timezone ambiguity
2026-07-25T22:50:58.123-04:00  ❌ zoned — a second, disagreeing clock
```

`CLAUDE.md §🔒` requires the recorded instant to **float**: parsed by explicit regex into `tMs`, read back
with `getUTC*`, so a night renders identically in any viewer timezone. `dex-ingest` derives the date
anchor from the *filename* stamp and the sample times from the *rows* — both must be the same civil clock.

**This is the failure mode with no symptom.** A phone writing epoch millis produces files that parse
cleanly, load without error, render a plausible night, and are wrong by your UTC offset. Nothing warns.

Two more rules from the same section:

- **Never fabricate a stamp for a dropped packet.** A gap is a gap; a missing sample must surface as
  absent. `never()` is not `now()`.
- **Stamp on arrival from the phone's own clock**, and discipline that clock. A device-time stamp from a
  sensor whose RTC has drifted is worse than a host stamp, which is why the box syncs device clocks and
  records that it did.

---

## 4. The O2Ring — ViHealth CSV, and the protocol you already own

**Output layout:** the **ViHealth CSV** that OxyDex parses, identical to what `oxyii.py` writes on the
box. Not a new format.

**Protocol** — fully documented in `capture-host/oxyii.py` (Apache-2.0, 100 % covered), and this is the
expensive knowledge worth carrying over verbatim:

```
device : Wellue O2Ring-S / T8520 — an OxyII device, NOT legacy Viatom
         (advertises "S8-AW"; every off-the-shelf Viatom tool silently fails against it)
flow   : connect (NO bond) → auth cmd=0xFF (XOR-keyed, no reply) → setup 0x10 (ack) → poll 0x04 ~1/s
frame  : [0xA5][cmd][~cmd][flag][seq][len_lo][len_hi][payload][crc8]
crypto : CRC-8 poly 0x07 over all-but-crc; MD5 + XOR. NO AES.
```

Two behaviours the box learned the hard way and an app will meet too: the ring **only advertises while
worn**, and it needs **no bond** — pairing it is unnecessary and invites the trust/reconnect race
(`VIGIL-DEEP-ANALYSIS §2D`).

---

## 5. Acceptance test

> **A file from the phone and a file from the box, for the same signal, must be interchangeable.**

Concretely, before the app is trusted with a real night:

1. Record the same session on both. Drop **both** sets into the same Dex — they must produce the same
   `fs`, the same night grouping, and the same device attribution.
2. `writers.file_device_id(<phone filename>)` must return the device serial, not `None`.
3. Load a phone night in a viewer set to a **different timezone**. The rendered clock must not move.
   This is the only cheap test for §3, and the bug it catches has no other symptom.
4. Confirm no `_RR` / header-only files are left behind for a session that produced no data — the box
   discards those, and the ingest walks whatever is on disk.

---

## 6. What this contract deliberately does NOT constrain

Language, SDK, UI, storage location, background-service strategy, whether the app is a live **recorder**
or a morning **collector** of onboard recordings. All of that is the app repo's call.

One note on that last choice, recorded because it came up: **the recorder shape is demonstrably
achievable** — PSL keeps research sessions alive on Android via a foreground service, and our own corpus
came out of it. The genuinely untried part is a *second, independent* BLE stack (the ring, raw
`BluetoothGatt`) running alongside the Polar SDK in one app, both contending for one adapter. That is
ordinary Android engineering rather than an open question, but it is the piece with no existing proof
and the right thing to prototype first. Either shape satisfies this contract.

---

## 7. Open questions

1. Do the H10 and Verity hold **offline recordings** worth collecting? `POLAR-OFFLINE-DOWNLOAD` found the
   Verity stores an exercise `.BPB` (HR series only) and **no raw-PPG `.REC`**. Pending a listing with the
   sensors near the box. This decides how much a collector-shaped app can actually recover.
2. Does the app write to a **shared** night folder with the box, or its own tree reconciled later? Two
   writers in one night dir is a merge problem the box has never had.
