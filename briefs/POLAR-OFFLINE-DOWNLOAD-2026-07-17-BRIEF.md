<!--
  POLAR-OFFLINE-DOWNLOAD-2026-07-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-07-17 · **Created:** 2026-07-17

# Polar onboard offline-recording download (PS-FTP), wired into the Vigil monitor

Pull the recording a Polar device (Verity Sense / H10) stores in its **own flash** when you press
the button to record without a phone — straight off the device over BLE, from the bedside monitor.
The Polar sibling of the O2Ring `.dat` puller (`pull_session.py` / `O2RING-PROTOCOL-…-BRIEF`), and a
concrete first execution of `POLAR-SDK-CAPTURE-2026-07-07-BRIEF` **Track A** ("prototype automated
offline-recording fetch"). Out-of-suite (`capture-host/`, HEALTH-BOX-VISION §4 host surface — not
gated by the Dex bundler/provenance suite). Branch `claude/verity-psftp-monitor`, commit `aa1fc09`
(not pushed).

## Why — and why USB is a dead end

The onboard recording is the device's own backstop: it survives a host/RF hiccup and needs no phone.
Until now the only way to get it was Polar Flow (official app, no Linux) or Polar Sensor Logger. We
already pull the equivalent off the O2Ring; this closes the same gap for Polar.

**USB gives you nothing here** (verified on the Verity, `0da4:0008` / iProduct "Polar INW4J"): over
USB the armband enumerates as a **HID device** (`/dev/hidrawN`), *not* mass storage — it only charges
and speaks Polar's private protocol over HID. There is no volume to mount, no file to copy. **BLE
PS-FTP is the only download path.**

## The protocol — Polar PS-FTP (RFC60 + RFC76)

Taken **verbatim from the official Polar BLE SDK** (`BlePsFtpUtils.kt`, `pftp_request.proto`,
`pftp_response.proto`; fetched via `gh api repos/polarofficial/polar-ble-sdk/...`) — not guessed.
All request+response traffic rides **one** GATT characteristic:

- Service `0000FEEE`, **MTU characteristic `FB005C51`** (write the request, reassemble the response
  from its notifications). `FB005C52`/`53` (D2H/H2D) are unused for a read.
- A request is wrapped **twice**:
  1. **RFC60** — a 2-byte little-endian length prefix over the protobuf (`[len&0xFF, (len>>8)&0x7F]`;
     top bit of byte 1 = 0 for REQUEST).
  2. **RFC76** air-packets — 1-byte header per packet: `bit0 = next` (0 first, 1 continuation) ·
     `bits1-2 = status` (`0x06` MORE / `0x02` LAST) · `bits4-7 = seq` (ring 0..15). Payload from byte 1.
- **`PbPFtpOperation{ command=GET(0), path }`** — GET a **directory** → response payload is a
  serialized `PbPFtpDirectory{ entries: PbPFtpEntry{ name=1, size=2 } }`; GET a **file** → raw bytes.
- Response reassembly: read notifications on `FB005C51`, validate `seq`, concat payloads across
  `MORE…LAST`; a `status=0` frame carries a 16-bit LE error code (`0` = OK ack).

The protobuf is **hand-rolled** (no runtime dependency) — the encode is 5–11 bytes, the decode a
small field-walker. The client is **GET-only**: it never writes or deletes on-device.

## What's in the repo

Three files under `capture-host/` (all out-of-suite):

- **`polar_psftp.py`** (new) — the client. `PolarPsFtp` (bonded bleak session context manager) +
  `list_recordings(address)` (walks `/U/0/`, groups a `…/E/TIME/` exercise or `…/R/TIME/` offline
  session with its files) + `pull_recording(address, session, out_dir)` (downloads every file under a
  session, mirrors the tree, writes a `recording.meta.json` sidecar). A CLI mirrors `pull_session.py`:
  `python polar_psftp.py --address <mac> list | pull --session <path> --out <dir>`.
- **`webmon.py`** — two endpoints: `GET /api/recordings?address=` (list) and `POST /api/pull
  {address,session}` (download into `captures/incoming`). Both bond first via
  `bonding.ensure_bonded`, and accept **only a remembered Polar address** (never an arbitrary
  LAN-supplied MAC).
- **`monitor.html`** — a **"📥 Recordings"** button per Polar device in the Devices view → lists the
  device's onboard sessions (start time · kind · file count · size) each with a **Download** button.

## Engineering findings (hardware, Verity Sense `0C301E3F`)

- **Bonding is mandatory.** Polar gates PS-FTP (and even Device-Information reads) behind an
  **encrypted/bonded link** — an un-bonded read returns `UNLIKELY_ERROR (14)` and drops. Bonded this
  host via a `bluetoothctl` Just-Works agent; it took bond **slot `/SYS/BT/1`** and did **not** evict
  the phone (slot 0) — the device holds two bonds.
- **What the Verity actually stores.** Enumerating the *entire* device FS (`/`) found exactly **one**
  recording: a **training/exercise session** `/U/0/20260716/E/170114/` (`.BPB` protobuf files;
  `SAMPLES.BPB` = an **HR time-series ~55–62 bpm**, *not* raw PPG; `TSESS.BPB` carries date/time/sport
  = 2026-07-16 17:01:14, "Other indoor"). **No raw-PPG `.REC` offline recordings exist** — the
  button-in-exercise-mode only saves HR. Raw multi-channel PPG is only available via **live PMD
  streaming** (which `capture.py` already does), never as a stored file on this unit/firmware.
  Everything else on flash is system/bond/profile (`/SYS/BT/…`, `USERID/PREFS/PHYSDATA`, `SYSLOG.BPB`).
- **Validated:** pulled the 7-file session, **every file byte-size-verified** against the
  device-reported size, to `Ecg nightly/Verity_Offline_0C301E3F_20260716_170114/`.
- **MTU stays 23 here.** BlueZ did not auto-negotiate up on this adapter (best-effort `_acquire_mtu()`
  is a no-op), so transfers run at 20-byte air-packets — fine for a 15 KB session, slow for a large
  `.REC`; a future large-file pull wants a real MTU bump.

## Known caveat — BLE link contention (the same gotcha as O2RING §reconnect)

A bonded **trusted** Polar device is **auto-reconnected by BlueZ**, which then fights bleak for the
device's single BLE slot and surfaces as `failed to discover services, device disconnected`. A
long-lived `webmon` (especially after churn — many killed test processes leave stale dbus/BlueZ
state) races this and the web-triggered pull can time out, while the **standalone CLI is reliable**
right after `bluetoothctl disconnect <mac>`. Mitigations landed: a best-effort **pre-disconnect** +
**3× retry with backoff** in the module, and disconnect-on-failed-connect so we never leak a half-open
link. On a clean bedside box — daemon owns/pauses BLE, device idle — it behaves like `pull_session.py`.
**Operational rule (in code + a UI hint): a Polar device holds ONE BLE link, so pause that device's
live capture and make sure it's idle before pulling.**

## Validation status

- [x] Protocol correct against real hardware (list + byte-verified 7-file pull), standalone CLI.
- [x] Endpoints serve + route: monitor page 200, `/api/state`, `/api/recordings`/`/api/pull` reach the
      module and return the ok/error JSON contract; modules parse + import clean.
- [ ] **Web-triggered pull demonstrated green** — blocked only by the BLE trusted-auto-reconnect race
      above in a churned test env; not reproduced clean. Re-verify on the box (or after a fresh
      `bluetoothctl disconnect`, idle device).
- [ ] H10 offline (RR) session pull — same code path, not yet exercised on an H10.

## Follow-ups

1. **`SAMPLES.BPB` → CSV decoder.** The pulled file is Polar's native `.BPB` (HR), *not* the PSL
   `_PPG/_ACC` txt layout the Dex suite ingests. A small protobuf decoder (HR-vs-time + avg/max/duration
   from `STATS`/`TSESS`) makes it usable; a PSL-shaped emitter would let it route like a live capture.
2. **Web-pull robustness** — settle the trusted-auto-reconnect race deterministically (temporary
   untrust for the pull window, or a supervisor "pause capture" hook the endpoint calls), and negotiate
   a large MTU for multi-MB `.REC` files.
3. **Automate the button** — `POLAR-SDK-CAPTURE` Track A's larger aim: trigger/stop an SDK offline
   recording (`REQUEST_START_RECORDING`/`STOP`) so the raw-PPG `.REC` structure actually gets written,
   then this puller retrieves it (the raw waveform PpgDex wants, without holding the link all night).

## Done when

Web pull demonstrated green on the box (or a clean radio), the `.BPB` decoder lands (follow-up 1), and
`how-to-collect/verity-ppg.md` gains the "pull onboard recording from the monitor" note. Until then the
feature is usable via the CLI + monitor with the idle-device caveat, so this stays **IN-PROGRESS**.
