<!--
  O2RING-USB-HID-NEGATIVE-2026-08-08-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-08 · **Created:** 2026-08-08

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

## What this does NOT claim

- **Not** "no protocol works over this pipe." What is established is that the OxyII envelope as
  documented for BLE, in every framing tried (rid 0/1–4/none, short and padded, with and without the auth
  handshake), gets no reply. A different framing could exist. Nobody has found one.
- **Not** that the vendor's USB export is impossible. The vendor tool may drive a different interface, a
  different protocol, or a mode this ring does not enter while a BLE client holds it.
- The two remaining cheap leads, if anyone wants them: watch `usbmon` to see whether the SET_REPORT is
  ACKed or dropped on the wire (needs root), and re-probe with **no** BLE client connected, in case the
  firmware binds the OxyII handler to one transport at a time.

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
