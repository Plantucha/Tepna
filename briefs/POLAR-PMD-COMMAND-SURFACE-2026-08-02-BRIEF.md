<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — PMD control-point surface, measured on hardware) · **Created:** 2026-08-02 · **Device:** Polar Verity Sense `0C301E3F` (`24:AC:AC:0C:30:1E`) · **Tool:** `capture-host/probe_pmd_surface.py` · **Companion:** `POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md` (§4a — the offline-recording bit)

# The Polar PMD command surface, as this device actually answers it

`POLAR-ONBOARD-BACKUP` §4a established the *offline recording* wire format by reading Polar's SDK.
This brief is the complement: **what a real Verity Sense answers when you ask it every documented
read-only question**, recorded verbatim so the next person does not re-derive it from Kotlin.

Every line below is one of three things, and the distinction is the whole point of the document:

| mark | meaning |
|---|---|
| **MEASURED** | this exact byte sequence was sent to this device and the reply is quoted |
| **DOCUMENTED — UNTESTED** | named in Polar's SDK; not sent here |
| **NOT TRIED — deliberate** | could have been sent; a reason not to exists, and it is stated |

**Prose is not evidence.** Where a claim is inference rather than observation it says so.

---

## 0 · How it was measured

`probe_pmd_surface.py`, three windows on 2026-08-02 between 19:40 and 21:00 EDT, against the live
capture box (`vigil`). The daemon was stopped for each window (`tepna-restart.sh stop`, deadman-timed)
because **a Polar grants exactly one BLE link** — every "device not found" and half the timeouts in this
project's history are that constraint, not a fault.

Conditions that materially affect the answers, all satisfied here: the device was **off the charger**
(a docked Polar refuses every PMD START with `0x0D in_charger`), **awake**, and **not recording** (a
recording device refuses all file transfer with `SYSTEM_BUSY`).

**The device (MEASURED, Device Information Service):**

| | |
|---|---|
| manufacturer / model | `Polar Electro Oy` / `INW4J` |
| serial | `0C301E3F` |
| hardware rev | `00784292.02` |
| **firmware rev** | `0.1.5` |
| **software rev** | `3.0.16` ← the number Polar's docs call "firmware"; offline recording needs ≥ 2.1.0 |
| battery at probe time | 96 % |

### 0.1 · The measurement problem you will hit first: the link often goes deaf

**MEASURED across four windows, and the fourth corrects the first three.** In three windows the link
accepted between **four and nine** control-point writes and then refused every subsequent one with GATT
`UNLIKELY_ERROR (0x0E)` — an ATT-layer refusal, not a control-point ACK carrying an error status. Once
one write is refused on a link, **all** subsequent writes on that link are refused. In the fourth
window the same code completed **all 36 commands on a single link with zero refusals**.

So the honest statement is: **this is intermittent, not a rate limit and not a per-command property.**
An earlier draft of this section asserted a hard ceiling of 4–9 writes; the clean run disproved it
before it shipped. `01 06` (MAG settings) was refused in one window and answered normally in the next,
and the daemon queries it successfully every session.

Consequences for anyone writing a tool against this device:

* **A refusal is a link event, not a verdict about the command.** Reading `UNLIKELY_ERROR` as
  "unsupported" would have produced a confidently wrong table here.
* **Sweeps must be resumable.** `probe_pmd_surface.py` holds its plan as a flat list with an index, so a
  dead link is answered by taking a new one and continuing at the failed command. Written as nested
  loops — the obvious way — position lives in the Python stack and the only recovery is starting over.
  One full sweep took **6 links**; the next took **1**.
* **Order the plan by scarcity.** The four one-shot queries are unique and cost one command each; the
  per-measurement queries cost 2×N and repeat similar answers. A run that completed 23 of 28 commands
  missed **all four** singles because the plentiful kind was asked first.
* **Reading the Device Information Service can drop the link.** In the first window, DIS reads before
  the control-point subscribe killed it outright. DIS is now read last, on its own link — and once it
  was, it succeeded.

Cause not established. Pacing is *consistent with* the observations (the sweep is the first thing here
to send tens of writes back-to-back; a 0.25 s gap was added, and the clean run came after it) but a
single clean run is not proof that the gap caused it. Treat it as unexplained.

---

## 1 · Control-point ops

Op numbers are what was sent. **The NAMES are the labels this project's code uses, taken from reading
`PmdControlPointCommand` in `polarofficial/polar-ble-sdk`; they were not independently re-verified
against a published enum in this session.** Where the device's answer contradicts a label, that is
flagged.

| op | label | this run | reply |
|---|---|---|---|
| `0x01` | GET_MEASUREMENT_SETTINGS | **MEASURED** | §2 |
| `0x02` | REQUEST_MEASUREMENT_START | **NOT TRIED** here (it writes) — but **MEASURED** in `POLAR-ONBOARD-BACKUP` Phase 1 | `02 <meas\|0x80> <TLVs>` starts an offline recording |
| `0x03` | STOP_MEASUREMENT | **NOT TRIED** here — **MEASURED** in Phase 1 | takes the **bare** type; `03 82` is refused with `UNLIKELY_ERROR` |
| `0x04` | GET_SDK_MODE_MEASUREMENT_SETTINGS | **MEASURED** | §2 — and it is the most interesting answer in this document |
| `0x05` | GET_MEASUREMENT_STATUS | **MEASURED** | `f0 05 ff 00 00 02 05 06 01 03 0e` |
| `0x06` | GET_SDK_MODE_STATUS | **MEASURED** | `f0 06 09 00 00 00` |
| `0x07` | GET_OFFLINE_RECORDING_TRIGGER_STATUS | **MEASURED** | `f0 07 ff 00 00 00 00 02 00 05 00 06 00 01 00 03 00 0e` |
| `0x08` | SET_OFFLINE_RECORDING_TRIGGER_MODE | **NOT TRIED — deliberate**, see §5 | — |
| `0x09` | SET_OFFLINE_RECORDING_TRIGGER_SETTINGS | **NOT TRIED — deliberate**, see §5 | — |
| `0x0A` | *(labelled GET_DERIVED_MEASUREMENT_SETTINGS in our code)* | **MEASURED** | `f0 0a ff 01 00` — **status `0x01` = `invalid_op`.** Either the label is wrong or the op does not exist on this firmware. Do not build on it. |

Anything outside this table was **NOT TRIED — deliberate**: sweeping undocumented opcodes against
firmware nobody here understands is not a reference-gathering exercise, it is a way to brick an armband.
`probe_pmd_surface.py` enforces this with an **allowlist** (`_check_allowed`) rather than a denylist —
an unknown opcode is assumed to write. That polarity is the opposite of the compute-closure denylist in
`CLAUDE.md`, and deliberately so: there an unknown asset must be assumed *dangerous* so the gate cannot
go blind; here an unknown *opcode* must be assumed dangerous so the probe cannot poke firmware.

### 1.1 · Reply envelope

**MEASURED, consistent across ops `0x01`/`0x04`/`0x05`/`0x07`/`0x0A`:**

```
f0 <op> <meas | 0xff> <status> [moreFlag] [payload...]
```

`status` uses `polar_pmd.CTRL_STATUS` (`0x00` ok · `0x02` invalid_meas · `0x03` not_supported ·
`0x0D` in_charger …). For the one-shot ops the third byte is `0xff` rather than a measurement type.
**`0x06` does not fit this shape** (`f0 06 09 00 00 00` — third byte `0x09`); its layout is not
established, so only the raw bytes are recorded.

---

## 2 · Settings menus — three of them, and they differ

**MEASURED.** Ask `0x01`/`0x04` with the measurement byte plain (online) or OR'd with `0x80` (offline).
The offline bit is the same one that turns a START into an onboard recording (`POLAR-ONBOARD-BACKUP`
§4a), and it changes what the device *offers*, not just what it does.

### 2.1 · Normal mode (`0x01`) — what `capture.py` sees today

| stream | online | offline (`\|0x80`) |
|---|---|---|
| PPG | 55 Hz · 22 bit · 4 ch | **identical** |
| ACC | 52 Hz · 16 bit · ±8 G · 3 ch | **13 / 26 / 52 Hz**, else identical |
| GYRO | 52 Hz · 16 bit · ±2000 dps · 3 ch | **13 / 26 / 52 Hz**, else identical |
| MAG | 10 / 20 / 50 / 100 Hz · 16 bit · ±50 G · 3 ch | **10 / 20 / 50 Hz** (100 dropped) |
| PPI | `f0 01 03 00 00` — ok, no settings | identical |
| ECG | `f0 01 00 03 00` — `not_supported` | identical (a Verity has no ECG) |

The offline menus *add* slower rates and *remove* the fastest. That is the ~2 MB flash budget showing
through the protocol: at 52 Hz an IMU stream fills it far sooner than at 13 Hz.

### 2.2 · SDK mode (`0x04`) — a substantially larger device

**This is the finding with the most design consequence in the document.** Op `0x04` reports what the
device would offer *in SDK mode*. SDK mode was **NOT** enabled (see §5); this is the menu, not a
demonstration that the rates work.

| stream | normal online (§2.1) | **SDK-mode online** | SDK-mode offline |
|---|---|---|---|
| PPG | 55 Hz | **28 / 44 / 55 / 135 / 176 Hz** | 28 / 44 / 55 Hz |
| ACC | 52 Hz, ±8 G only | **26 / 52 / 104 / 208 / 416 Hz**, ±2/4/8/16 G | 13 / 26 / 52 Hz, ±2/4/8/16 G |
| GYRO | 52 Hz, ±2000 only | **26 / 52 / 104 / 208 / 416 Hz**, ±250/500/1000/2000 dps | 13 / 26 / 52 Hz, same ranges |
| MAG | 10 / 20 / 50 / 100 Hz | 10 / 20 / 50 / 100 Hz (unchanged) | 10 / 20 / 50 Hz |
| PPI | no settings | no settings | no settings |

**PPG at 176 Hz is 3.2× what Tepna captures tonight**, and the selectable IMU ranges matter for
anything doing motion physics rather than activity counting. Note also that **offline recording stays
capped at 13/26/52 Hz (PPG 28/44/55) even in SDK mode** — the flash budget binds regardless.

Two cautions before anyone acts on this table:
1. **Offered ≠ accepted.** The device advertising 176 Hz is not the device sustaining 176 Hz over BLE
   for eight hours. `POLAR-ONBOARD-BACKUP` §4a's memory limits and this project's own history of
   `ERROR_INVALID_PARAMETER` on plausible-looking TLVs both argue for measuring before believing.
2. **SDK mode is a mode.** It is entered by a control-point write, and what it does to the HR service,
   to battery life, and to an in-progress capture is **not established here**.

---

## 3 · The device clock — settable, and it lies to you about it

**MEASURED 2026-08-02T20:10 EDT.** This independently reproduces a finding from 2026-07-18 that until
now lived only in a source comment (`polar_psftp.py:307-324`).

The Verity exposes **two clocks**, and they are not the same clock:

* the one it **answers about** — PS-FTP `GET_LOCAL_TIME` (query 4)
* the one it **stamps samples with** — the PMD `sensor_ns` field, ns since 2000-01-01

```
before   GET_LOCAL_TIME  2026-08-03T00:09:49     sample stamp  2026-08-03T00:09:56
         host local      2026-08-02T20:10:00     host UTC      2026-08-03T00:10:00
         -> the device stamps UTC

write    SET_LOCAL_TIME  2026-08-02T20:10:00 , tz_offset_min = -240      -> ACCEPTED

after    GET_LOCAL_TIME  2026-08-02T20:10:05  <- took the local civil time
         sample stamp    2026-08-03T00:10:19  <- STILL UTC, 14415 s adrift
```

**Conclusion: `SET_LOCAL_TIME` is accepted, `GET_LOCAL_TIME` echoes it faithfully, and the PMD sample
clock does not follow.** The sample clock is UTC and this path cannot move it.

Why this is a trap and not a curiosity:

* **Reading the clock back is not verification.** It confirms the write landed *somewhere*. A tool that
  sets local time, reads it back, sees local time and reports success has verified nothing about the
  timestamps in the files it is about to write — this repo's recurring failure class: machinery that
  passes without exercising anything.
* **The Clock Contract stores floating LOCAL civil time** (`CLAUDE.md` §1). Device stamps are UTC. An
  onboard recording decoded without applying the offset lands **4 h off and looks entirely plausible**
  in a sleep file — the wrong kind of wrong, the kind that survives review.
* **This is why `capture.py` sets every device to UTC with `tz_offset = 0`** (`polar_psftp.set_local_time`).
  One device cannot be moved off UTC, so the only way to put *siblings* on a common origin — the
  precondition cross-device timing needs — is to put the settable ones (H10) on UTC too. That decision
  is now measured, not inherited.

**NOT TRIED — deliberate:** `SET_SYSTEM_TIME` (query 1) with a local-civil value, and `tz_offset` values
other than `-240`/`0`. Both were tried on 2026-07-18 and neither moved the sample clock; re-testing
them costs a BLE window to re-confirm a negative.

Any probe that writes this clock **must restore the daemon's UTC convention in a `finally`** — the
probe does, and the restore is verified in the output (`"restored"`). Left on local civil, every device
stamp for the following night shifts by the UTC offset.

---

## 4 · Undocumented measurement types — three advertised, one real

**MEASURED.** A plain GATT **read** of the control point returns the supported-measurement bitmask:

```
0f 6e 62 00 00 ...        ->  types {1, 2, 3, 5, 6, 9, 13, 14}
                              ppg acc ppi gyro mag  +  0x09, 0x0D, 0x0E
```

Polar publishes five measurement types for a Verity Sense. **This device advertises eight.** Asking the
documented settings-read op (`0x01`) about each — a read, not a poke at an unknown opcode — separates
them cleanly:

| type | `0x01` reply | status | reading |
|---|---|---|---|
| `0x09` | `f0 01 09 02 00` | `0x02 invalid_meas` | advertised in the bitmask, **rejected** as a measurement |
| `0x0D` | `f0 01 0d 02 00` | `0x02 invalid_meas` | same |
| `0x0E` | `f0 01 0e 00 00` | **`0x00 ok`**, no settings payload | **a real, supported measurement type with no configurable settings** — the same reply shape as PPI, i.e. an event stream rather than a sampled waveform |

Corroboration that `0x0E` is genuine and `0x09`/`0x0D` are not, from **four** independent replies:
`0x0E` appears in the measurement-status list (`0x05`) and the trigger-status list (`0x07`), and
answers `0x00 ok` to **both** settings-read ops — `0x01` **and** `0x04` (`f0 04 0e 00 00`). `0x09` and
`0x0D` appear in neither list and answer `invalid_meas` to both ops. The bitmask is the only place they
exist.

**What `0x0E` carries is NOT established.** Skin temperature is a plausible guess for an optical
armband and it is *only* a guess — this document does not name it. Establishing it means starting the
stream and decoding frames, which is a write and a separate, scoped experiment. That is the honest
state: a confirmed extra channel of unknown content.

---

## 5 · What was deliberately not tried, and why

* **`0x08` / `0x09` — the offline-recording trigger writes.** These **persist across power cycles**. A
  trigger left armed makes the device start recording *by itself* on every power-up, which quietly
  consumes the ~2 MB flash budget and — because one data type cannot be both offline and online
  (`POLAR-ONBOARD-BACKUP` §2) — removes the live stream the nightly capture depends on. A probe that
  leaves the device in a different state than it found it is not a probe. Arming a trigger is a design
  decision with a rollback plan, not a sweep item. `POLAR-ONBOARD-BACKUP` argues triggers may make the
  runtime start path unnecessary; that evaluation is still owed and it is not this document.
* **Entering SDK mode.** §2.2's menu was read without it. Enabling it is a write whose effect on an
  in-progress capture, on the HR service and on battery is unknown.
* **Every undocumented opcode.** See §1.
* **Encryption.** Offline records can be AES-128 encrypted at start; default remains unencrypted
  (`POLAR-ONBOARD-BACKUP` §4a).

---

## 6 · Open, and what would close it

| question | what would settle it |
|---|---|
| What does measurement type `0x0E` carry? | start it, decode frames — a write, needs its own scoped probe |
| Does SDK mode's 176 Hz PPG actually sustain over BLE for a night? | enable SDK mode, negotiate 176 Hz, measure delivered vs expected sample count |
| Does **PPG** accept the offline bit? (ACC is proven; PPG is the stream the backup exists for) | `probe_verity_offline.py --meas ppg --force-record` |
| Does an offline recording survive a link drop? | start it, drop the link, reconnect, read `0x05` |
| What container comes off the flash, on what timebase? | pull one and decode — `POLAR-ONBOARD-BACKUP` §6 Q3, and §3 above says assume UTC |
| Why does the link go deaf, intermittently? | cause unestablished; pacing is a hypothesis a single clean run does not confirm |

---

## 7 · Reproducing this

```sh
# a Polar grants ONE link — take it off the daemon first (deadman-timed, comes back by itself)
sudo -n /usr/local/lib/tepna/tepna-restart.sh stop 20

python probe_pmd_surface.py --address 24:AC:AC:0C:30:1E --json surface.json
python probe_pmd_surface.py --address 24:AC:AC:0C:30:1E --include-undocumented-types --json surface.json
python probe_pmd_surface.py --address 24:AC:AC:0C:30:1E --clock-only --json clock.json   # WRITES the clock, restores it

sudo -n /usr/local/lib/tepna/tepna-restart.sh restart
```

Run the sweep and the clock leg as **separate invocations** — they share a BLE window but not a budget,
and combining them spent the whole timeout on the sweep and never reached the clock, three windows in a
row. The device must be **off the charger**; a docked Polar refuses every START with `0x0D`.

The JSON records the raw hex of every command and reply (`transcript`), every ATT-layer refusal
(`gatt_refused`), how many links it took (`links_used`), and how much of the plan completed
(`commands_completed`) — so a partial run is still usable evidence rather than a traceback.
