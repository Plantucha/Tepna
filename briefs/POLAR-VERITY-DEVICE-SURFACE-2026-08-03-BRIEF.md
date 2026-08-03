<!--
  POLAR-VERITY-DEVICE-SURFACE-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — protocol reverse-engineering, validated on hardware) · **Created:** 2026-08-03 · **Unit:** Verity Sense `0C301E3F`, sw 3.0.16 · **Companions:** `POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md` (the command sweep) · `POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md` (why) · `PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md` (what rate buys)

# Polar Verity Sense (INW4J) — BLE surface, PS-FTP filesystem & the `.REC` container

Reverse-engineered + hardware-validated reference for the **Polar Verity Sense** as used by the Tepna
capture box (`capture-host/`, out-of-suite). Covers the full GATT map, the complete PMD instruction set,
SDK mode, offline recording, the **device filesystem**, the **on-flash `.REC` format**, the timebase,
and two security findings.

**There is no reference implementation to check against.** `polarofficial/polar-ble-sdk` issue
[#556](https://github.com/polarofficial/polar-ble-sdk/issues/556) ("Accessing offline recording using
python") is **open and unanswered**, and the main community library
([`zHElEARN/polar-python`](https://github.com/zHElEARN/polar-python)) is streaming-only — no control
point, no SDK mode, no offline recording, no PS-FTP. External refs: Polar's own
[PolarVeritySense.md](https://github.com/polarofficial/polar-ble-sdk/blob/master/documentation/products/PolarVeritySense.md)
(capability table only) and the FCC filing [fccid.io/INW4J](https://fccid.io/INW4J) (internal photos
public; schematics and block diagram are confidentiality-restricted, and **no public teardown with chip
identification exists**).

Code: `capture-host/polar_pmd.py` (PMD) · `polar_psftp.py` (PS-FTP) · `polar_mirror.py` (filesystem
mirror) · `rec_to_psl.py` (`.REC` → Dex input) · `probe_verity_survey.py` (full survey) ·
`probe_pmd_opcodes.py` (instruction-set map) · `link_guard.py` (the precondition).

## 1 · Identity

`DEVICE.BPB` and the Device Information Service agree, and Polar puts the **FCC ID in the model field**
— so a unit self-attests and a mismatch is worth noticing:

| | |
|---|---|
| manufacturer / model | `Polar Electro Oy` / **`INW4J`** (= the FCC ID) |
| hardware rev | `00784292.02` · colour `Black` · size `Unisex` |
| firmware rev (DIS 2A26) | `0.1.5` |
| **software rev** (DIS 2A28) | **`3.0.16`** — the number Polar's docs call "firmware" |
| BLE EUI-64 | `24ACAC FFFE 0C301E` |
| components (`DEVICE.BPB` f14) | **`BleApp`** and **`BleBootloader`**, each with its own version |

The advertisement carries **manufacturer data (company `0x6B`)** — device state readable **without
connecting**, which matters because the device grants only one link (§10.1).

## 2 · GATT map — eight services

```
fb005c80-…   Polar PMD          fb005c81 [read,write,indicate]  control point
                                fb005c82 [notify]               data
0000feee-…   Polar PS-FTP       fb005c51 [write,write-nr,notify]  MTU / RFC76
                                fb005c52 [notify]  ·  fb005c53 [write,write-nr]
0000180d-…   Heart Rate         2A37 [notify]      — emits at 1 Hz, ALWAYS 0000 (§3.3)
0000180f-…   Battery            2A19 [read,notify]
0000180a-…   Device Information 2A23/24/25/26/27/28/29
00001800/01  Generic Access / Attribute
6217ff4b-…   UNDOCUMENTED       6217ff4c [read] = 81 01 00 00 …
                                6217ff4d [write,indicate]
```

**`6217ff4b-fb31-1140-ad5a-a45545d7ecf3` is present on the H7 and H10 as well**, and the community has
documented its existence for years with the purpose recorded as *unknown*. Nothing here writes to it.

**There is no temperature sensor.** No Health Thermometer (`0x1809`), no Temperature characteristic
(`0x2A6E`/`0x2A1C`), and Polar's own capability table lists only HR, PPG, PPI, ACC, GYRO, MAG.

## 3 · The PMD control point (`fb005c81`)

### 3.1 · The instruction set is COMPLETE

Swept `0x00`–`0x3F` by sending each opcode ALONE — a real op rejects the *call* (`invalid_meas`), an
absent one rejects the *opcode* (`invalid_op`), so existence is inferred from the status code without
executing anything.

| opcode | |
|---|---|
| `0x01` GET_MEASUREMENT_SETTINGS · `0x02` START · `0x03` STOP · `0x04` GET_SDK_MODE_SETTINGS | exist |
| `0x05` MEASUREMENT_STATUS · `0x06` SDK_MODE_STATUS · `0x07` TRIGGER_STATUS | exist (parameterless) |
| `0x08`/`0x09` trigger writes | exist per SDK; **not sent — they persist across power cycles** |
| **`0x00`, `0x0A`–`0x3F`** | **`invalid_op` — all 54** |

**`0x01`–`0x09` is the whole surface. There is no hidden opcode.** Device state was byte-identical
before and after the sweep. (This also settles `0x0A`, which some of our code labelled
`GET_DERIVED_MEASUREMENT_SETTINGS`: it does not exist.)

### 3.2 · Reply envelope

`f0 <op> <meas|0xff> <status> [moreFlag] [payload…]`, statuses per `polar_pmd.CTRL_STATUS`. `0x06` does
not fit this shape (`f0 06 09 00 00 01`) and its final byte is the SDK-mode flag.

### 3.3 · The feature bitmask mixes measurements and MODES

A plain GATT **read** of `fb005c81` returns `0f 6e 62 00…` → bits `{1,2,3,5,6,9,13,14}`. Five are
measurements (PPG, ACC, PPI, GYRO, MAG); three are **capability flags**: `0x09` **SDK_MODE**, `0x0D`
**OFFLINE_RECORDING**, `0x0E` **OFFLINE_HR**. The tell: a flag answers `invalid_meas` to a settings
read, while `OFFLINE_HR` — naming a real recordable data type — answers `ok` with an empty menu.

⚠️ **Do NOT add these to `pmd.MEAS_NAME`.** `webmon` decides what is capturable with
`not str(x).startswith("0x")`, so naming them there offers three modes to the user as streams
(gate-locked by `test_capability_flags_are_not_offered_as_streams`).

**HR emits but is empty.** Subscribing to `2A37` yields a notification every second, every one `0000`
with `contact_supported: false`. So `worn` can never be derived for this device — not because it is
silent, but because it declares no contact support — and the not-worn battery-saving link drop can
never fire for it.

## 4 · Settings menus — and SDK mode changes what `0x01` returns

Query with the measurement byte plain (online) or OR'd with `0x80` (**offline**). Measured values match
Polar's published table exactly.

| stream | online | **offline** | SDK-mode online |
|---|---|---|---|
| PPG | 55 | **28 / 44 / 55** | 28/44/55/**135/176** |
| ACC | 52 | **13 / 26 / 52** | 26/52/104/208/**416**, ±2/4/8/16 G |
| GYRO | 52 | **13 / 26 / 52** | 26/52/104/208/**416**, ±250…2000 dps |
| MAG | 10/20/50/100 | 10/20/50 | 10/20/50/100 |
| PPI | no settings | no settings | no settings |
| ECG | `not_supported` | — | — |

**While SDK mode is ON, `0x01` returns the SDK menu** — so "online vs sdk" collapses; `0x04` always
shows it. Entry is `02 09`, exit `03 09`, and `0x06`'s final byte reports it. **It persisted ~13 h**
across many reconnects and adapter power cycles.

⚠️ **Build an offline START from the OFFLINE menu, never the online one.** With SDK mode on, ACC online
offers `[26,52,104,208,416]`; `chosen_rate` falls through to `max()` = 416 Hz; the offline menu permits
only `[13,26,52]`; the device answers **`invalid_sample_rate`**. ACC passed in Phase 1 only because SDK
mode was off and the online menu happened to be legal offline too. Any implementation reusing the live
negotiation breaks silently the moment SDK mode is enabled.

## 5 · Offline recording

The onboard recording is **the ordinary START with `0x80` OR'd into the measurement byte** — same
characteristic, same settings payload. **STOP is not symmetric**: one STOP, the BARE type; `03 82` is
refused at the ATT layer with `UNLIKELY_ERROR`.

| stream | offline bit |
|---|---|
| **PPG · ACC · GYRO · MAG** | ✅ confirmed by the device's own status (`0x05`) |
| **PPI** | ❌ `invalid_state` — permanently unusable on this unit |

**Confirm with `0x05`, never the ACK** — an ACK means the request was accepted. And a stop is not
prompt: a recording asked to stop after 20 s ran on to **46 s**.

⚠️ **`in_charger` (`0x0D`) is NOT simply "docked".** Measured both ways on one day: on a wall charger at
3→12 % battery, SDK-mode entry *and* four measurement STARTs all returned `ok`; on USB at 100 %, a PPG
START was refused `in_charger`. Two variables were not held fixed — **wall charger vs USB host**, and
**charge level**. USB attachment is the leading candidate. Do not assume either way.

## 6 · The PS-FTP filesystem

GET-only in `polar_psftp`. `polar_mirror.py` walks from `/` and pulls everything (43 files, 37 dirs).

```
/  DEVICE.BPB  PRODDATA.BIN  LEDCFG.BIN(=0101)  SYSLOG.BPB  SYNCINFO.BPB
   ERRORLOG.BPB  ERRORLO2.BPB
/SYS/BT/<n>/  BTDEV.BPB  SVSTATUS.BPB  VENDORDT.BIN     <- one dir per bonded host
/U/  UDB.BPB  USENSET.BPB (PS-FTP error 106 on GET)
/U/0/  USERID.BPB  DBDC.DAT  S/{PHYSDATA,PREFS,UDEVSET}.BPB
       <YYYYMMDD>/R/<HHMMSS>/<STREAM>.REC     <- PMD offline recordings
       <YYYYMMDD>/PHYSDATA/<HHMMSS>/…         <- user physiology
       <YYYYMMDD>/E/<HHMMSS>/…                <- exercise sessions (button-started)
```

`ERRORLOG.BPB` decodes to entries of `{component, firmware, date, time}` — the observed one names a
component **"Wolfi"** at 3.0.16. **Nothing was logged for any of a full day's BLE link failures**, which
is evidence those are host-side rather than device faults.

## 7 · The `.REC` container — no new decoder needed

```
0x00  17-byte header (00 2b 4c 7c 3d 01 … 75 ba 6d f9)
0x11  ASCII "YYYY-MM-DD HH:MM:SS"  (19 bytes) — the start, in UTC
0x26  the PMD settings TLVs, VERBATIM from the START that created it
then  records of 281 B = [meas][8-byte LE ns since 2000-01-01][frame_type][269-byte payload][2 B]
```

The payload is **PMD data frames byte-identical to the live link**, so `pmd.decode_frame` handles them
unmodified and the file declares its own rate/resolution/channels.

⚠️ **The record is longer than its frame.** A 281-byte PPG record decodes cleanly at **+279/+280** and
raises "truncated after 52 samples" at +281 — there are **2 trailing bytes** (unidentified, plausibly a
CRC). Slicing to the next frame's offset feeds them to the delta decoder, which reads them as a block
header that cannot complete and discards all 52 good samples. 52 is exactly 944 ms × 55 Hz, which is
what showed the data was present and the *boundary* was wrong.

**Frame cadence is not constant** — PPG ~944 ms, ACC ~2.4 s — because the device batches by BYTES. Take
timing from `sensor_ns`, never from a frame index.

Verified: 300 frames → **15 580 samples, 282.85 s, 55.08 Hz, zero warnings**, and PPGDex parses it.

## 8 · Timebase — UTC, and a field name that lies

The header stamp matched a host UTC clock to **−0.3 s**, and the per-frame `sensor_ns` agrees. The
Clock Contract's canonical `tMs` is floating **LOCAL civil** time, so a night decoded without the offset
lands hours off and looks entirely plausible. `polar_psftp` writes this field into
`recording.meta.json` as **`start_local`**, which it is not. `rec_to_psl.py --tz-offset-min` converts at
the boundary and declares which timebase it wrote.

A consistent **1.8–3.4 s** gap sits between the header stamp and the first data frame across all 15
files — the device's start-up cost, reproducible enough to correct for.

## 9 · ⚠️ Security & privacy — a mirror of this device is sensitive

* **`/U/0/USERID.BPB`** carries the owner's **real name** and Polar account UUID.
* **`/SYS/BT/<n>/BTDEV.BPB` is the bonding table** — one directory per paired host, each holding that
  peer's address and a **128-bit key**. Anything that reaches PS-FTP can read the pairing secrets for
  **every** host the device is bonded to, not just its own. Two slots were populated, one of them a
  second host last seen weeks earlier.

`polar_mirror.py --redact` blanks both; output defaults to the gitignored capture root. The export
pipeline scrubs serials via `dexScrubExport`; **device files have no such pipeline**, so the care has to
live in the tool. No device file content belongs in this repo.

## 10 · Operational quirks

### 10.1 · One link, and the daemon usually has it
A Polar grants exactly **one** connection. With `tepna-capture.service` up, a probe's connect appears to
succeed and every GATT call then fails with a message about BlueZ. This cost **five runs in one day**,
twice leaving a recording running that the probe could not stop. `link_guard.require_free_link()` is one
import and refuses to start. Note the deadman timer restarts the daemon by itself, so a long probe can
lose the link **mid-run**.

### 10.2 · `Trusted: no` breaks PS-FTP and the error does not say so
`PolarPsFtp.__aenter__` fails at `start_notify(MTU_CHAR)` with `UNLIKELY_ERROR` — the same code an
un-bonded read gives — while `bluetoothctl info` reports **Paired: yes, Bonded: yes**. The missing
property is **TRUST**. One `bluetoothctl trust <addr>` and everything works. Bonded-but-untrusted is
indistinguishable from unbonded at the ATT layer.

### 10.3 · Use the context-manager form
`async with BleakClient(...)` holds a link on this device where an explicit `connect()` did not — the
first control-point WRITE raised `Service Discovery has not been performed yet` while a bare
connect+read diagnostic showed 8 services and 21 characteristics on 3 of 3 attempts.

### 10.4 · Mirror once, analyse locally
The link is the scarce unreliable resource; analysis is free. One `polar_mirror.py` pass answered every
subsequent question offline.

## 11 · Open

| question | status |
|---|---|
| **On-body offline recording → PPGDex** | **the one that matters.** Every test recording was made in the charging dock, so PPGDex correctly reports no coherent pulse (rMSSD 300 ms). The path is proven *mechanically* only. |
| Does an offline recording **auto-stop**? | Two stranded recordings ended at **exactly 77 434 B / 258.9 s**. If real, onboard backup cannot cover a night. Untested — needs an undisturbed ~15 min. |
| `in_charger` — USB or charge level? | §5. Start a PPG recording on a plain wall charger. |
| Does a recording survive a link drop? | untested |
| What `6217ff4b` does | unknown here and publicly |
| Button-started `/E/` sessions | none present — Polar Flow appears to sync and remove them |

## 12 · Method notes

Recorded because each produced a confident wrong answer with no error message.

1. **Enumerate before probing.** A full opcode sweep of one characteristic ran before anyone listed the
   GATT table — and listing it revealed an eighth service.
2. **`Service Discovery has not been performed yet` was diagnosed five times.** Stale GATT cache
   (adapter cycle — nothing), disconnect timing (settle — nothing), the daemon holding the link (true
   once), the feature read costing the link (plausible, not it), and finally the call shape. A ten-line
   connect+read diagnostic separated "the radio is fine" from "my code is wrong"; reasoning from the
   error text never did.
3. **Keep the traceback.** Collapsing failures to `type: message` discarded the frame that identified
   the cause in one read.
4. **A flat result is not a finding until a positive control shows the measurement can move.**
5. **"USB reads what BLE refuses" was wrong** — it was `Trusted: no` (§10.2). The USB route worked but
   was never necessary.
