<!--
  POLAR-OFFLINE-DOWNLOAD-2026-07-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS (pull core + charger/doff triggers SHIPPED and gate-tested; verified 2026-09-01 against the done-when: the `.BPB` decoder is still UNLANDED — the only `BPB` mentions in the tree are `polar_mirror.py`'s PII/bonding-table notes, no decoder module — and the on-box web-pull demonstration is still unrecorded, so this stays open on both counts. Related but not closing it: the H10 RR-acceptance probe endpoint (`POLAR-ONBOARD-BACKUP-FOLLOWUPS` §4) is in flight 2026-09-01) · **Created:** 2026-07-17

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

> ### ⚠️ CORRECTION 2026-08-14 — "USB gives you nothing" is FALSE. The conclusion survives; the reasoning does not.
>
> The paragraph above is right that the Verity enumerates as HID rather than mass storage, and right
> that BLE is the only path that can **pull a file**. It is wrong about the interesting part, and wrong
> in the direction that stops a reader from looking: **PS-FTP rides the USB HID pipe.** Measured on the
> real Verity `0C301E3F`, 2026-08-02, and recorded in `capture-host/probe_polar_usb.py` — two 64-byte
> interrupt endpoints (`0x01 OUT` / `0x81 IN`) served a genuine PS-FTP directory listing for `/U/0/`
> (`DBDC.DAT`, `USERID.BPB`, `S/`, a date-named session directory). `polar_psftp`'s protobuf layer
> parses it unchanged; only the framing differs (v800_downloader's, not BLE RFC76). `CHANGELOG.md`
> carries the same finding.
>
> **Why the first probe concluded "dead end", since the failure mode is instructive:** two off-by-one
> errors, each of which makes a working pipe look dead — `is_end()` is `(packet[1] & 3) == 1`, so
> flags==1 is END and flags==0 is MORE (the `11 04 ..` reply is "ACK me", not a terminator); and the
> RFC60 length is **`len + 4`**, not `len` (a bare length is accepted and answered with nothing).
>
> **What USB still cannot do, and why the section's verdict stands anyway:** the server answers only in
> a window that opens on **USB re-enumeration**, and that window is **ONE REQUEST WIDE** — proven by
> replug, where the first GET returned the listing and the next a second later returned 1-byte filler
> (171 attempts at 1 Hz → 0). `tepna-usbreset.sh` is deployed under `/usr/local/lib/tepna/` and opens
> the window on demand, but one request cannot carry a multi-packet file. So USB is a **listing and
> diagnostic channel**, not a pull path.
>
> ⚠️ **Never cite a USB listing as the device's filesystem.** The single reply is capped at one 64-byte
> report, the device flags it END regardless, and the payload ends mid-record — `/U/0/` has six entries
> by the BLE mirror and USB returned four plus a stub, decoding one into a fabricated filename `"20"`.
> Fixed in `polar_psftp.TruncatedProtobuf` / `_parse_directory_ex` (PR #1117), which also covered the
> **BLE** walk, where `polar_mirror` would otherwise have written a MANIFEST claiming a subset was whole.
>
> ⚠️ **Never sweep opcodes on this pipe** — a sweep of byte1 across `0x00..0xFF` re-enumerated the
> device mid-run. `polar_psftp._ALLOWED_QUERIES` exists for that hazard.
>
> **The correction that matters for planning:** the section's framing is "BLE is the only path" as a
> statement of sufficiency. It is only a statement of *necessity*. A separate finding — that the
> **daemon's** BLE pull had never once succeeded in production (27×409, 2×502 over seven days, with
> `captures/stored/*offline*` empty for both Polars) — sits alongside the "Validation status" checkbox
> above recording a byte-verified 7-file pull **via the standalone CLI**. Those are consistent: the
> protocol works, the shipped web-triggered path is what remains unexercised, which is exactly what the
> open Done-when box says. Do not read this correction as reopening that box.

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
- **`webmon.py`** — two endpoints: `GET /api/polar/recordings?address=` (list) and `POST /api/polar/pull
  {address,session}` (download into `captures/stored`). Both bond first via
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
- [x] Endpoints serve + route: monitor page 200, `/api/state`, `/api/polar/recordings`/`/api/polar/pull` reach the
      module and return the ok/error JSON contract; modules parse + import clean.

> **Route rename on the vigil-merge (2026-07-18):** PR #153 landed the Polar endpoints at `/api/recordings`
> + `/api/pull`, but the live capture-host had **already** taken `POST /api/pull` for the **O2Ring** stored-`.dat`
> pull (`pull_stored_h`, uncommitted at the time). Reconciling the two, the Polar endpoints moved to
> **`/api/polar/recordings`** + **`/api/polar/pull`** so both coexist (O2Ring keeps `/api/pull`). `polar_psftp.py`
> is unchanged; only the webmon route strings + the monitor's `pullRec`/`doPull` fetch paths differ.
- [ ] **Web-triggered pull demonstrated green** — blocked only by the BLE trusted-auto-reconnect race

  > **📡 PRECONDITION RE-STATED 2026-08-04, from the live box — "idle-device gated" was too vague to act on.**
  > Observed this morning (09:57 EDT) on the running appliance:
  >
  > | device | state |
  > |---|---|
  > | Wellue O2Ring-S | `connected=True`, `worn=False` (`no finger contact`) |
  > | Polar H10 | `connected=False` — **`TimeoutError` on connect** |
  > | Polar Verity Sense | `connected=False` — **`TimeoutError` on connect** |
  >
  > The watchdog has logged `Polar:off, Polar:off` on every 30-min tick since at least 09:00. **The two
  > Polars are not busy — they are unreachable**, powered down or out of range after the night. So the
  > blocker is not "wait for the device to go idle"; there is no idle-but-reachable state to wait for,
  > because the moment a Polar *is* reachable the capture daemon takes the one BLE link.
  >
  > **The precondition, stated so it can actually be met:** *a Polar powered on and in range, while the
  > operator triggers the pull through the daemon's own web path* (which is what this item tests — the
  > daemon owning the link is the design, not an obstacle). Practically that is a deliberate daytime
  > window with the strap on the charger but awake, not an opportunistic overnight moment.
  >
  > **Last night was NOT a miss** — all three legs captured: H10 `219.9 MB` ECG from 21:21, Verity
  > `97.0 MB` from 21:21 plus `6.4 MB` from 04:48, O2Ring `153 MB`. The link works; only the *pull* is
  > unexercised.
  >
  > **Bonus confirmation from the same log:** at 08:30 the watchdog caught
  > `connected-but-silent: Wellue O2Ring-S=1757s` and fixed it with `restart 1/3`, after which
  > `daemon=active` and `Wellue:up`. The silent-stream detector is working **in production**, on a real
  > wedge, unprompted — the failure mode it was written for.
      above in a churned test env; not reproduced clean. Re-verify on the box (or after a fresh
      `bluetoothctl disconnect`, idle device). **2026-07-22: still open — IDLE-DEVICE-GATED.** The box is
      running under a `systemd --user` service (see `CAPTURE-HOST` §11 note) but both Polars were
      **actively streaming a live recording** at every check (Verity ppg/acc/gyro/mag, H10 ecg/acc/hr, not
      charging), and `_polar_run` pauses a device's live capture for the pull — so demonstrating the pull
      would interrupt a real night. Deliberately NOT triggered; it rides the next off-body/idle window.
- [ ] H10 offline (RR) session pull — same code path, not yet exercised on an H10. **Same idle-device gate.**
- [x] **`how-to-collect/verity-ppg.md` monitor-pull note** — **DONE 2026-07-22.** Added the "pull the
      onboard recording straight from the Vigil monitor" subsection (📥 Recordings button + CLI mirror +
      the one-BLE-link idle rule + the HR-only-in-exercise-mode caveat), describing the CLI-validated path.

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

## 🔁 RECONCILED 2026-08-26 — follow-up 3's mechanism LANDED, and the same measurements retire its aim

Re-checked every Done-when clause against the code rather than against this brief's prose. The status
does not change — but follow-up 3 does, and it changes in the direction nobody was watching.

**Done-when, re-measured:**

| clause | verdict 2026-08-26 |
|---|---|
| `how-to-collect/verity-ppg.md` note | ✅ still done (2026-07-22) |
| **`.BPB` decoder (follow-up 1)** | ❌ **absent.** `BPB` occurs in `polar_mirror.py`, `polar_psftp.py`, `probe_polar_usb.py` only as *filenames* — PII handling (`PII = {"/U/0/USERID.BPB"}`), the `BTDEV.BPB` bonding table, directory listings. No decoder, no CSV emitter, anywhere in `capture-host/` or `tools/`. |
| **web pull green on hardware** | ❌ still unexercised. `/api/polar/pull` + `/api/polar/recordings` route and are contract-tested (`test_webmon_api.py`, `test_webmon_endpoints.py`), but every one of those tests is **mocked**. A passing endpoint test is not a demonstrated pull. |

So the brief is correctly IN-PROGRESS. The reconciliation is elsewhere.

### Follow-up 3 is no longer blocked on an unknown — it is blocked on arithmetic

Follow-up 3 asks to "trigger/stop an SDK offline recording (`REQUEST_START_RECORDING`/`STOP`) so the
raw-PPG `.REC` structure actually gets written, then this puller retrieves it (the raw waveform PpgDex
wants, without holding the link all night)". Written 2026-07-17, when the command surface was unknown.

**The mechanism landed** — `polar_pmd.py`: `OFFLINE_BIT = 0x80`, `as_offline()`, `is_offline_cmd()`.
START carries the offline bit; **STOP takes the BARE type** (there is exactly one STOP per measurement
type), measured on real hardware 2026-08-02 by sending `03 82`. Reference: `POLAR-PMD-COMMAND-SURFACE`.

**But two facts measured since make the stated aim unavailable, and neither is in this brief:**

1. **The raw-PPG `.REC` does not fit in the flash.** The ceiling is ~2 MB; raw 4-channel 22-bit PPG is
   ~297 B/s, giving **~1.96 h** — not a night. Polar's own "up to 600 h" is the *same* ceiling read
   from the other end (`600 h × 3600 s × 1 Hz × 1 B = 2.16 MB`), i.e. a **1 Hz heart-rate** figure, and
   the device says so itself: `0x0E OFFLINE_HR` is its own measurement type with an empty settings menu
   because there is only one rate. Two independently-derived ratios agree to 3 % (297× vs 306×).
   See `VERITY-OFFLINE-VS-STREAMING` §1 / §1.0 — which also warns, precisely against this reading, not
   to carry "600 h" off a spec sheet into a PPG plan.
2. **Offline PPG is EXCLUSIVE with live PPG.** One data type cannot be both: starting an offline PPG
   recording means there is no live PPG stream — `ERROR_ALREADY_IN_STATE` (`polar_pmd.py`, brief §2).
   So automating the button does **not** add a backstop beneath the live capture; for PPG it *replaces*
   it. HR is the documented exception and rides the Heart Rate Service rather than PMD, so it is not
   expressible through this path at all.

**Consequence — the two follow-ups swap places.** Follow-up 3's premise was "get the raw waveform
without holding the link all night"; the device can hold neither the waveform nor both modes at once,
so for PPG that premise is dead rather than merely unimplemented. What the flash *does* support is
exactly the HR-rate offline recording (`0x0E OFFLINE_HR`) that the `.BPB` files on the device already
are — which makes **follow-up 1 (the `.BPB` decoder) the one that carries the value**, and follow-up 3
collapses into it rather than standing beside it. Re-scope follow-up 3 to HR-offline, or drop it; do
not implement it for PPG on the strength of the 2026-07-17 framing.

⚠️ Nothing here was refuted by a new experiment — every number was already measured, in briefs written
after this one. The defect was distributional: the answer existed somewhere the next reader of *this*
brief had no reason to look. That is the argument for reconciling briefs on a schedule rather than on
suspicion.

## Done when

Web pull demonstrated green on the box (or a clean radio), the `.BPB` decoder lands (follow-up 1), and
`how-to-collect/verity-ppg.md` gains the "pull onboard recording from the monitor" note. Until then the
feature is usable via the CLI + monitor with the idle-device caveat, so this stays **IN-PROGRESS**.
