<!--
  O2RING-USB-HID-NEGATIVE-2026-08-08-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-09 · **Created:** 2026-08-08 (mechanism found 2026-08-09: the vendor USB path is HID **Feature** reports, which this ring STALLs — see §"The mechanism") — ⚠️ **mechanism PARTLY REFUTED 2026-08-29**: a direct `usbmon` capture of `O2 Insight Pro` ↔ the O2Ring S shows the vendor app drives **this** ring with **Output** reports (`hid_write`), not Feature — see **§UPDATE 2026-08-29**.

# The O2Ring-S's USB-HID pipe is not an OxyII responder — measured, not assumed

**Out-of-suite (`capture-host/`).** No Dex bundle / `manifestHash` / provenance impact. This records a
**negative result** and the evidence for it, so the next person who docks the ring and sees a HID device
does not spend an evening rediscovering that nothing is listening.

## The question

The Wellue O2Ring-S (T8520) docks on the capture box's USB and enumerates a HID interface. `oxyii.py`
already implements the OxyII frame protocol — `0xA5 | cmd | ~cmd | flag | seq | len | payload | crc8` —
**transport-agnostically**, with no BLE coupling: `crc8`, `encode`, `auth_payload`, the file frames, a
`Reassembler`, `decode`, `parse_live`. If those frames rode the USB pipe, a stored-session pull would
need no radio at all — no scan, no wedged dongle, no on-charger advertising mode. Worth twenty minutes
to find out.

They do not.

## 🔴 UPDATE 2026-08-29 — the `usbmon` capture was NOT moot, and it partly refutes the Feature-report mechanism

The one test this brief flagged as still-owed — *"a USB capture of `O2 Insight Pro` … to confirm the
Feature-report framing positively rather than by elimination"* (§What this does NOT claim) — was run,
against **the O2Ring S itself** (`O2 Insight Pro V1.8.14` under Wine on the dev box; `usbmon`;
`/tmp/o2ring-capture.pcapng`, 20 888 pkts, ring = dev 9). It **overturns the mechanism**, not the
practical headline.

**What the vendor app actually sends to THIS Nordic ring — Output reports, not Feature:**
- 94 × `SET_REPORT` **Output** (`bmRequestType 0x21`, **reportType=Output, reportID=0, wLength=64**,
  parsed from the setup bytes) — i.e. `hid_write`, the transfer type this ring **accepts**. Zero Feature
  reports in the whole exchange.
- 165 × `GET_REPORT` reads (Wine relays `hid_read_timeout` as control reads; on real Windows these are
  interrupt-IN `ReadFile`).
- Frame format is a **length-prefixed HID report**: `[08][ 8-byte 0xA5/0xAA frame ][zero-pad to 64]`,
  where `08` = payload length. Report ID stays **0** — sending report ID `8` STALLs, confirming `08` is
  data, not an ID (this also re-explains the old rid-sweep: only rid 0 is valid).
- The detection poll alternates two commands, retried ~44× each: **`08 · a5 e0 1f 00 00 00 00 22`** — a
  `0xA5` frame with **op `0xE0`**, a hello/identify opcode NOT in `oxyii.py`'s set — and
  **`08 · aa 15 ea 00 00 00 00 8d`** (`0xAA` cmd `0x15`).

**So the 2026-08-09 conclusion — "the vendor's USB protocol is HID FEATURE reports … the ring cannot
speak it even in principle because it refuses that transfer type" — is wrong for the O2Ring S.** The app
imports BOTH surfaces (`hid_send_feature_report` AND `hid_write`); the Feature / `Holtek_HIDApi.dll` path
is for the *legacy Holtek* rings, and against the Nordic O2Ring S the app uses `hid_write` (Output),
which this ring accepts. The Feature-report STALL was a real observation attached to the wrong transport.

**What survives, refined.** The practical headline — *nothing useful comes back over USB* — still holds,
but for a different reason than a stalled transport:
- The ring **accepts** the Output commands (no STALL) yet returns only a **constant idle status
  `05 00 00 00 00 05`** to every command (op `0xE0` hello included), read via `HIDIOCGINPUT`; its
  interrupt-IN endpoint is **silent**.
- **The vendor app itself failed to connect** — it showed "No device connected", and its `GET_REPORT`
  reads came back **0 bytes** (Wine relays `hid_read_timeout` as control `GET_REPORT`, which this ring
  answers empty; direct Linux `GET_INPUT` gives the 6-byte idle). So the auth/handshake never completes,
  because the ring's responses are not readable on the channel available here.
- **Wear state is not it** — worn + plugged is byte-identical idle, which falsifies the "a mode this ring
  does not enter" bullet for the wearing case.

**Net:** the "writes land in a void / OxyII not bound" reading was too strong — writes are *accepted* and
the vendor app *does* address this ring with a concrete, now-known framing (`[08]`-prefixed `0xA5/0xAA`,
hello op `0xE0`). But no data exchange completes because the **read/auth path is unobservable here**
(interrupt-IN silent; Wine's control `GET_REPORT` empty). The `usbmon` question was therefore the
decisive test, not moot — and what is now owed to close it **positively** is a capture of a *successful*
`O2 Insight Pro` download on **real Windows** (native or a USB-passthrough VM), where `hid_read_timeout`
reads interrupt-IN and the handshake can complete; the Wine capture only shows the detection loop
failing. Full byte-level notes: memory `o2ring-usb-hid-protocol`. This does **not** change the
operational call — the **failover-radio** work remains the real fix for the download pain; USB stays a
bonus, now with its framing half-solved rather than declared impossible.

## What the device is

```
1-5   1915:f33c   Nordic Semiconductor / O2Ring S   serial 000000000001
        1 interface, class 03 (HID), 1 endpoint: 0x81 EP 1 IN, interrupt, 64 B, bInterval 1
        NO OUT endpoint  → writes leave as SET_REPORT(Output) over ep0
        /dev/hidraw0
```

⚠️ **It enumerates under NORDIC's vendor id (`0x1915`), not Viatom's.** The ring *advertises* as Viatom
(`0x036F`) and in OxyII mode as `0xF34E`, so a USB scan filtered on the vendor ids you know from the
radio walks straight past it. That cost one pass here.

Report descriptor, all 33 bytes of it:

```
06 00 FF   Usage Page (Vendor-Defined 0xFF00)
09 01      Usage 1
A1 01      Collection (Application)
15 00 26 FF 00 · 75 08 · 95 40
09 01 81 02      INPUT   64 B
95 40 09 01 91 02   OUTPUT  64 B
95 40 09 01 B1 02   FEATURE 64 B
C0
```

No Report ID item, so the hidraw report-id octet is `0x00`.

## What was measured

Read-only throughout — the allowlist was enforced in the probe and `0x01 SET_CONFIG`, `0xC0 SET_UTC_TIME`,
`0xE3 FACTORY_RESET`, `0xEE FACTORY_RESET_ALL` were never sent (`oxyii.py` already marks that class
deliberately unimplemented; this kept it that way).

| probe | result |
|---|---|
| `write()` of a GET_INFO frame, rid `0x00`, short **and** padded to 65 | **accepted** — 9/9 and 65/65 bytes |
| every read-only opcode (`0xE1 0xE4 0x00 0xF1 0xF4 0x03 0x04 0x05 0x10`), 3 s window | **silence, all nine** |
| documented handshake in order — `0xFF` AUTH → `0x10` SETUP → `0xE1` → `0xE4` | **silence** |
| passive listen, 10 s, while the ring was streaming over BLE | **0 unsolicited reports** |
| `HIDIOCGFEATURE` | **STALL — errno 32 EPIPE**, though the descriptor declares a Feature report |
| legacy Viatom framing (different protocol family) as a control | accepted, silence |
| **report-id sweep — the key control** | `rid=0` accepted; `rid=1,2,3,4` and no-rid all **STALL, errno 32** |

## Why this is a real negative and not a failed handshake

Three independent legs, and the third is the one that closes it:

1. **The transfers reach the device and it discriminates.** The report-id sweep is the control that makes
   the rest interpretable: the ring **STALLs every report id except 0**. A pipe that ignored us would
   accept or reject uniformly. It is parsing the control transfer and validating a field.
2. **Declared ≠ implemented.** `GET_FEATURE` STALLs on a Feature report the descriptor advertises. So the
   descriptor is a template, not a description of behaviour — which is exactly what a stock Nordic
   vendor-HID transport looks like when no application handler is bound behind it.
3. **The stack was demonstrably awake the whole time.** This is what rules out "the ring is asleep on the
   charger", the obvious alternative explanation. During the silent probes the ring was **BLE-connected to
   the daemon and actively streaming** — `connected=True`, `…_OXYFRAME.txt` growing by 14 379 bytes in two
   minutes. Same firmware, same moment, answering the identical protocol on the radio and nothing on USB.

**Conclusion: OxyII is not bound to the USB HID interface.** Writes land in a void.

**Inference, flagged as inference:** the interface is most likely the Nordic USB stack's stock
vendor-HID transport, present because USB is enabled for charging/DFU, with no handler attached. The
descriptor boilerplate and the declared-then-stalled Feature report both point that way. This was **not**
established — it is the reading that fits, and it is not needed for the conclusion above, which rests
only on the measurements.

### 🔎 THE MECHANISM, FOUND 2026-08-09 — and it is better than that inference

Two further tests, and then the vendor's own PC installer, closed this.

**Test 1 — the mode hypothesis, run properly.** The first sweep ran while the daemon held a BLE link, so
"the firmware binds its handler to one transport at a time" was live. `tepna-restart.sh stop 3` (the
deadman-timed verb that exists precisely so a tool can take a sensor's link off the daemon) gave a clean
window with the daemon `inactive`: **every read-only opcode, with and without the `0xFF`→`0x10` handshake,
silent; 30 s of patient listening, 0 bytes.** The ring also **did not advertise** in 18 s of scanning with
nothing holding it — but "asleep" was already excluded by the first sweep, where it was BLE-connected and
actively streaming `OXYFRAME` while USB was equally silent. Both states are covered.

**Test 2 — read the vendor's Windows app.** `O2InsightProSetup v1.8.14` (Inno Setup; extracted read-only
with `innoextract` into a temp dir, nothing executed) ships **`Holtek_HIDApi.dll`**, genuinely imported by
`O2 Insight Pro.exe` — it carries the error string `"holtek write time out."` and the DLL exports
`CloseHIDDevice`. Its Windows HID surface is:

```
HidD_GetFeature / HidD_SetFeature      ← the transport
HidD_GetAttributes · HidD_GetHidGuid · HidD_GetPreparsedData · HidP_GetCaps
SetupDiGetClassDevsW · SetupDiEnumDeviceInterfaces · CreateFileW
```

**The vendor's USB protocol is HID FEATURE reports — the exact transfer type this ring STALLs.**
`HIDIOCGFEATURE` returned `errno 32 EPIPE` in the very first pass, and at the time that only looked like
"declared but unimplemented". It is the whole story: the ring cannot speak the vendor app's USB protocol
even in principle, because it refuses the transfer type that protocol is built on.

**Corroborating, and consistent:** the app's model-code→name table lists `22010100 Checkme O2 Ultra`,
`SA-10AW`/`PF-10BW`/`2B01 Checkme O2 Max`, `Checkme_O2`, `SleepU`, `SleepO2`, `0004 OxyRing/O2Ring/WearO2/
KidsO2`, `0003 BabyO2 S2`, `0005`/`0006 Baby Sleep Monitor S1/S2`, `BabyO2`, `0001 Oxylink/Oxyfit` — **the
O2Ring S is not in it.** (A literal `O2Ring S` string does appear in the binary, but ~100 strings away,
surrounded by settings keys — `birthday`, `height`, `isAutoSyncData`, `CurOxiThr`, `HRLowThr` — and `/DATA`.
That is a config or folder label, not a device-table entry. Stated because it is the one string that
looks like counter-evidence and is not.)

⚠️ **A check that proved nothing, recorded so it is not repeated:** counting raw little-endian `04d9`
(Holtek) and `1519` (Nordic) byte pairs in the binaries returned 34 vs 33 — noise in a 2.4 MB file, since
any 2-byte sequence recurs by chance. `strings` cannot see numeric VID/PID constants, so the device ids
were never located; the conclusion rests on the Feature-report transport and the device table, not on this.

**So the revised reading:** the vendor USB data path is a **Holtek-family Feature-report protocol** for the
legacy, Holtek-MCU rings. The O2Ring S is **Nordic**-based (`1915:f33c`), stalls Feature reports, and is
absent from that table — while the vendor's own current SDK for it
([`viatom-develop/LepuDemo`](https://github.com/viatom-develop/LepuDemo), `lepu-blepro-1.0.7.aar : add
PF-10AW-1, O2Ring S`) is **BLE-only**, depending on `no.nordicsemi.android:ble` with no USB path anywhere.

This also resolves the apparent tension with the protocol reference's line about *"byte equivalence between
BLE-pulled files and the vendor app's USB export"*. That compares **files**, not transports, and says
nothing about the T8520 speaking USB — most plausibly the export came from a legacy Holtek device or by
another route. Nothing in that document ever claimed OxyII rides USB; it is titled *BLE Protocol*
throughout, and its only other USB mention is `FACTORY_RESET_ALL` needing USB to **wake** the ring, i.e.
power.

## What this does NOT claim

- **Not** "no protocol works over this pipe." What is established is that the OxyII envelope as
  documented for BLE, in every framing tried (rid 0/1–4/none, short and padded, with and without the auth
  handshake), gets no reply. A different framing could exist. Nobody has found one.
- **Not** that the vendor's USB export is impossible. The vendor tool may drive a different interface, a
  different protocol, or a mode this ring does not enter while a BLE client holds it.
- ~~The two remaining cheap leads~~ — **both spent 2026-08-09, see the mechanism section above.** The
  no-BLE-client re-probe was run under `tepna-restart.sh stop 3` and was silent; ~~the `usbmon` question is
  now moot, because the vendor app's transport turns out to be HID **Feature** reports, which this ring
  STALLs outright.~~ ⚠️ **This was wrong — see §UPDATE 2026-08-29.** The `usbmon` capture was run and was
  the decisive test: the vendor app drives this ring with **Output** reports, not Feature, so it was never
  moot. What would still settle the last 1 %: a capture of a *successful* `O2 Insight Pro` download on real
  Windows, to see the full auth→file-list→file-data handshake the Wine capture couldn't complete.

## What was confirmed on the way

The codec was byte-verified against an **independent** oracle transcribed from the protocol reference —
not by calling our own code for the expected value: the published fixture `A5 E1 1E 00 02 00 00` → `0xBF`,
`encode(0xE1, seq=2)` reproducing that frame whole, CRC agreement across all 256 single bytes and 1924
two-byte pairs, and `auth_payload` matching `derive_session_key` at four timestamps **including** the
vendor's peculiar `>>0,1,2,3` shift (`78 3c 9e cf`, where a normal byte-extract would give `78 56 34 12`).

⚠️ This **confirmed existing coverage rather than adding any** — `tests/test_oxyii.py` already pins that
fixture in two places. Recorded because "we verified the codec" is worth nothing without saying against
*what*, and an oracle that calls the implementation under test is not one.

## Enabling work that DID land

`systemd/99-tepna-hidraw.rules` (PR #1039) — `/dev/hidraw*` is root:root 0600 and capture.py runs
unprivileged, so the probe needed a udev rule. That PR also **adopted** the hand-installed Polar dock rule
which was in no repo and on no manifest, and taught `check-system-files.sh` to report a `SUPERSEDED` /etc
file. Those stand on their own merit regardless of this negative result: the Polar USB pull depends on
that rule and would have died silently on the next rebuild.

## Related

- [`CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md) — §2 V-items, the same "verify before trusting" discipline.
- [`VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md`](VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md) — the BLE path this would have bypassed, and why bypassing it is attractive.
