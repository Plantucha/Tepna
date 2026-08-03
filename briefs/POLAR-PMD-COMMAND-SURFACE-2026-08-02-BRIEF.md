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

### 2.2a · ENTERING SDK mode — measured 2026-08-02, and it is `02 09`

**MEASURED, and the opcode was INFERRED before it was confirmed.** Nothing in this repo or in §1's table
documented how to *enter* SDK mode. The inference: `GET_SDK_MODE_STATUS` (`0x06`) replies
`f0 06 09 00 00 00`, and since every other reply is `[f0, op, meas, status]`, that `0x09` sits in the
**meas** slot — i.e. SDK mode is addressed as "type `0x09`" on the ordinary START/STOP ops. Polar Sensor
Logger exposes these rates, so the *capability* was never in doubt; only the encoding was.

```
0x06 status         f0 06 09 00 00 00        <- final byte 0 = SDK mode OFF
ENTER   02 09  ->   f0 02 09 00 00           <- status 0x00 = ok
0x06 status         f0 06 09 00 00 01        <- final byte 1 = SDK mode ON
```

So: **`02 09` enters, `03 09` exits, and `0x06`'s final byte is the flag.** Note `0x09` answers
`invalid_meas` to a *settings* read (§4) while being perfectly valid as a START target — a mode has no
settings menu, which is consistent, not contradictory.

**⚠️ SDK MODE PERSISTS ACROSS A DISCONNECT.** This is the load-bearing operational fact and it was not
predicted. The probe's `finally` never landed its `03 09` (the link died first), and the *daemon's own
log* then showed the enlarged menu on a fresh connection two minutes later:

```
21:09:33  (before)  ppg options: rate_hz=[55]
21:11:53  (after)   ppg options: rate_hz=[28, 44, 55, 135, 176]
                    acc  [26,52,104,208,416] range [2,4,8,16]
                    gyro [26,52,104,208,416] range [250,500,1000,2000]
```

Two consequences. **Good:** SDK mode is a durable device setting, so a capture daemon does not have to
re-enter it every session. **Bad:** it is exactly the kind of persisting state change §5 refuses to make
casually — a device left in SDK mode keeps a changed menu for every later consumer, and nothing in the
BLE surface announces it except `0x06`. **Any tool that enters SDK mode owes an explicit exit path and
a status check**, and any tool that reads a settings menu should treat it as mode-dependent rather than
as a device constant.

**In production since 2026-08-02:** the Verity runs PPG at **176 Hz** (`config.yaml` `rates: ppg: 176`).

> ⚠️ **THE RATIONALE THAT FOLLOWED HERE WAS MEASURED, AND IT WAS WRONG.** See
> `PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md`. It argued that at 55 Hz one sample is 18.2 ms against a
> sleep rMSSD of 20–60 ms, so beat-timing quantisation was a large fraction of the measurement, and that
> 176 Hz would cut it to 5.7 ms and discriminate real pulse alternans from a peak-picking artefact.
> **`ppgdex-dsp.js:942` (`refineFeet`) already interpolates each systolic foot to a FRACTIONAL sample
> index**, so beat times were never on the sample grid and the mechanism claimed does not exist.
> Decimating one night — the only control that holds physiology fixed — shows **rMSSD invariant from 44
> to 176 Hz** and **PAT residIQR flat from 25 to 176 Hz**, with a cliff at 22 Hz. The rate was inferred
> from a sample interval without checking that anything downstream was limited by it; `refineFeet` was
> three lines away in the same file. Measured verdict: **floor 25 Hz, recommended 44–55 Hz, no gain
> above** — 176 Hz buys ~1.5 % of a term that is not the limiting one, for **1.81× the battery**
> (4.74 → 8.60 %/h). Kept in production on the owner's call (11.6 h runtime is ample for a ~6 h night),
> not on this argument. GYRO/MAG were simultaneously cut to their floors (26 / 10 Hz) to pay for the bytes — both feed
a ~0.1–0.6 Hz effort waveform, so 26 Hz is ~43× the widest band of interest.

⚠️ **`chosen_rate` honours a configured rate ONLY if the device offers it**, silently falling back
otherwise. So a config asking for 176 without SDK mode records at 55 and *looks* like it worked, and a
config asking gyro for 20 Hz (not on the SDK menu, whose floor is 26) silently gets 52. Always confirm
the negotiated menu in the daemon log, never the config value.

Two cautions still standing on §2.2's table:
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

## 4 · The bitmask carries CAPABILITY FLAGS as well as measurements

> **CORRECTED 2026-08-03.** The first version of this section called `0x09`/`0x0D`/`0x0E` "undocumented
> measurement types" and left open what `0x0E` carries, floating skin temperature as a guess. That was
> wrong, and it was wrong in the avoidable way: **this repo already knew the answer, and had it
> gate-locked.** `capture-host/webmon.py:606` names them, and
> `tests/test_webmon_settings_contract.py::test_capability_flags_are_not_offered_as_streams` pins the
> behaviour that depends on it. I measured a real device before searching the tree, and turned settled
> knowledge back into an open question. The measurements below are unchanged and correct; the *framing*
> was not. Search first.

**MEASURED.** A plain GATT **read** of the control point returns the feature bitmask:

```
0f 6e 62 00 00 ...        ->  bits {1, 2, 3, 5, 6, 9, 13, 14}
                              ppg acc ppi gyro mag  +  0x09, 0x0D, 0x0E
```

Polar publishes five measurement *types* for a Verity Sense and this device sets eight bits — because
**the bitmask is not purely a list of measurements.** It also advertises **modes**:

| bit | what it is | measured behaviour |
|---|---|---|
| `0x09` | **SDK_MODE** | `0x01`/`0x04` → `f0 01 09 02 00` = `invalid_meas`; absent from the status (`0x05`) and trigger (`0x07`) lists |
| `0x0D` | **OFFLINE_RECORDING** | same — `invalid_meas`, in neither list |
| `0x0E` | **OFFLINE_HR** | `0x01`/`0x04` → `f0 01 0e 00 00` = **`ok`**, no settings payload; **present** in both the status and trigger lists |

So there is **no unknown extra channel and no temperature stream** — `0x0E` is the device advertising
that it can record **HR to its own flash**, which is a fact about `POLAR-ONBOARD-BACKUP`'s subject
rather than a new sensor.

The `ok`-versus-`invalid_meas` split is still a genuine and useful observation: `OFFLINE_HR` names a
recordable **data type** (HR), so a settings query about it is meaningful and answers `ok` with an
empty menu — PPI's shape. `SDK_MODE` and `OFFLINE_RECORDING` name pure **modes** with no data behind
them, so the same query is rejected outright. That asymmetry is a reliable way to tell a flag from a
stream on a device whose bitmask mixes both.

**The consumer-side rule already exists and should not be re-derived:** `polar_pmd` names only the
measurements it can decode and leaves everything else as `0x…` hex, so an unnamed entry means exactly
*"not a stream we can capture"*. `webmon` filters on that to avoid offering a checkbox that can never
work. ⚠️ **Do not "fix" this by adding `0x09`/`0x0D`/`0x0E` to `pmd.MEAS_NAME`** — the filter is
`not str(x).startswith("0x")`, so naming them there would make the UI offer three modes as capturable
streams. If they ever need names, they need a *separate* table.

---

## 5 · What was deliberately not tried, and why

* **`0x08` / `0x09` — the offline-recording trigger writes.** These **persist across power cycles**. A
  trigger left armed makes the device start recording *by itself* on every power-up, which quietly
  consumes the ~2 MB flash budget and — because one data type cannot be both offline and online
  (`POLAR-ONBOARD-BACKUP` §2) — removes the live stream the nightly capture depends on. A probe that
  leaves the device in a different state than it found it is not a probe. Arming a trigger is a design
  decision with a rollback plan, not a sweep item. `POLAR-ONBOARD-BACKUP` argues triggers may make the
  runtime start path unnecessary; that evaluation is still owed and it is not this document.
* ~~**Entering SDK mode.**~~ **DONE 2026-08-02 — see §2.2a.** It is `02 09`, it works, and it
  **persists across a disconnect**. Its effect on battery over a full night is still unmeasured, and
  that is now the open risk rather than the encoding.
* **Every undocumented opcode.** See §1. (Note the distinction §4 turns on: an unrecognised *opcode* is
  never sent; an unrecognised *bitmask bit* is only ever asked about with a documented READ op.)
* **Encryption.** Offline records can be AES-128 encrypted at start; default remains unencrypted
  (`POLAR-ONBOARD-BACKUP` §4a).

---

## 6 · Open, and what would close it

| question | what would settle it |
|---|---|
| Does SDK mode's 176 Hz PPG sustain over a full night, and what does it cost in battery? | **running in production since 2026-08-02** — compare delivered vs expected sample count and battery at wake |
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
python probe_pmd_surface.py --address 24:AC:AC:0C:30:1E --include-flag-bits --json surface.json
python probe_pmd_surface.py --address 24:AC:AC:0C:30:1E --clock-only --json clock.json   # WRITES the clock, restores it

sudo -n /usr/local/lib/tepna/tepna-restart.sh restart
```

Run the sweep and the clock leg as **separate invocations** — they share a BLE window but not a budget,
and combining them spent the whole timeout on the sweep and never reached the clock, three windows in a
row. The device must be **off the charger**; a docked Polar refuses every START with `0x0D`.

The JSON records the raw hex of every command and reply (`transcript`), every ATT-layer refusal
(`gatt_refused`), how many links it took (`links_used`), and how much of the plan completed
(`commands_completed`) — so a partial run is still usable evidence rather than a traceback.
