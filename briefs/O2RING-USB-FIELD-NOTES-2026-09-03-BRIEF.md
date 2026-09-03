<!--
  O2RING-USB-FIELD-NOTES-2026-09-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living) · **Created:** 2026-09-03

# O2Ring-S USB — the field notes behind `o2ring.py`, and the dead ends

> **What this is.** The knowledge `capture-host/o2ring.py` *acts on* but does not *explain*, written
> down because it existed only in one session's context. `O2RING-USB-PROTOCOL-2026-08-30-BRIEF.md` is
> the protocol reference; this is the bring-up record beside it — what the hardware actually did, what
> was tried and abandoned, and which claims rest on what.
>
> **Provenance is marked on every claim** and the labels are load-bearing:
> **[HW]** observed on real hardware · **[SDK]** read out of the vendor SDK (`lepu-blepro-1.3.9`)
> · **[3P]** a third party's independent implementation behaving a certain way · **[INF]** inferred,
> never observed. An [SDK] label stays [SDK] after real bytes turn up; the capture is noted beside it
> rather than replacing it, because provenance does not stop being true when better evidence arrives.

---

## 1 · Transport, exactly as it must be

**[HW]** VID `0x1915` PID `0xF33C`. The unit these notes come from: wire serial `2592302100`,
branch code `2D010002`.

**[HW]** Commands go OUT over the HID **control** endpoint as `SET_REPORT`, with a `0x00` report id
prepended — a 65-byte write for a 64-byte report. Replies come back on **interrupt-IN `0x81`** as
64-byte reports. The working transport is precisely:

    interface 0 · SET_IDLE(0) wIndex 0 · SET_REPORT Output wValue 0x0200 length 64 · read IN 0x81

**[HW] What is NOT in it, each having been tried:** no `SET_INTERFACE`, no `0x10` SETUP command
before AUTH, and no second endpoint. There is one IN endpoint and it is `0x81`.

⚠️ **[HW] `0x83` in the first capture was a different device on the bus** — a mouse/keyboard/BT
radio, not the ring. An early reading treated it as the ring's second endpoint and looked for replies
there. If a future capture shows traffic on `0x83`, check the device address before concluding
anything about the ring.

## 2 · The frame, and the one byte the CRC does not cover

**[HW]** `[len][body][crc]`, where `len = len(body) + 1` and **the CRC covers the body only — not the
len byte**. Getting that wrong produces frames the ring silently ignores, which reads as a dead
device rather than as a checksum error.

**[HW]** `body = magic · op · ~op · flag · seq · len_lo · len_hi · payload`, magic `0xA5` (or `0xAA`
on the legacy poll). CRC-8/SMBUS: poly `0x07`, init `0`, no reflection, no final xor.

**[HW] Multi-report reassembly.** A payload larger than one report is split, and only the FIRST
report carries the `a5`/op header — continuations are raw payload bytes. The rule is: concatenate
`report[1 : 1 + report[0]]` while `report[0] == 0x3f` (63, a full report's worth), and stop on the
first short one. A reader that expects a header on every report loses every large reply, which in
practice means every `FILE_DATA`.

## 3 · AUTH is fire-and-forget, and this is the single most expensive fact here

**[HW] The ring NEVER answers `0xFF` on this firmware. Not once, ever.** Its first reply to anything
is a HELLO (`0xE0`) ack — `08 a5 e0 1f 01 00 00 00 34` — and **that ack is the auth-success signal**,
the same event as the ring's display flipping to the two-arrows icon.

⚠️ **The dead end this created, because it cost the most time.** `authenticate()` originally did
`read_reply(want_op=OP_AUTH)` — it waited for a reply to AUTH. **That call can never return.** The
symptom is a client that hangs forever against a working, unlocked ring, which looks exactly like a
transport fault and sends you back to re-checking endpoints and report ids.

**[HW] What works instead** is a loop, not a preamble: roughly once a second send all four of
`{AUTH a5ff, AUTH aaff, legacy poll aa15ea, HELLO a5e0}` while a reader polls `0x81`; an `e0` reply
means success, and you proceed to GET_INFO / FILE_LIST. It must run continuously from immediately
after enumeration — a silent gap breaks readiness.

**[SDK]** The key: `_LEPU = md5(b"lepucloud")`; `key[0:8]` = the even-indexed bytes of `_LEPU`;
`key[8:12]` = the first four ASCII characters of the serial (the SDK's own default is the literal
`"0000"`, which works); `key[12:16]` = `time()` as an **LE uint32**; the payload is `key XOR _LEPU`.

⚠️ **[HW] The timestamp encoding was wrong for months and passed anyway.** The original port shifted
`(ts >> 0,1,2,3) & 0xFF`, and its own docstring called that "a faithful port of the vendor code —
both sides match". It was neither. A USB capture of the real vendor app settled it on `key[13]`: the
shift form predicts 14 distinct values over a 27-second window, LE-uint32 predicts a constant, and
the capture showed `key[13:16]` constant at `2e 94 6a`. The bytes also decode as an LE epoch to the
minute the capture was running, which a wrong encoding does not do by accident.
**[INF] Why it never broke anything:** the ring appears not to validate this field strictly — it
tolerates it as a loose nonce. That is why a real encoding bug sat behind a passing link.

## 4 · Getting the ring to talk at all

**[HW] A software `reset_device()` does NOT reproduce the unlock.** A real, physical replug is
required — and it took the **second** one: at bus address 11 the ring received the full hello-loop
and answered nothing; at address 12 it answered in about ten seconds.

**[HW] Post-replug readiness is stochastic.** Budget replug + hello-loop for ~15 s and repeat two or
three times before concluding anything is wrong. An autonomous puller probably needs a switchable
powered hub for this reason.

⚠️ **[HW] DISPROVEN: the "reset and it persists for ~150 s" theory.** It was tested on hardware and
is false. Do not build a timing window on it.

## 5 · The pull, and its two traps

**[HW]** `FILE_LIST 0xF1` → `FILE_START 0xF2` → `FILE_DATA 0xF3` → `FILE_END 0xF4`.

- **[HW]** `FILE_START` payload is the **14-character session id in ASCII, left-justified into 24
  bytes with NULs** — *not* a timestamp-plus-filetype pair, which was the first (wrong) reading. The
  reply carries the size as a `u32 LE` at `payload[0:4]`.
- **[HW]** `FILE_DATA` payload is the offset as `u32 LE`; the reply is a multi-report frame in 512-byte
  chunks, reassembled by the `0x3f` rule of §2.
- **[HW] The ring REFUSES `FILE_START` while it is being WORN.** `FILE_LIST` still answers. Pull
  off-body or docked. A refusal here is not a protocol error.
- **[HW]** No re-hello and no re-AUTH during a pull; authentication persists after the `e0` ack.

**[HW]** Stored files begin with a 10-byte header `01 03 00 00 00 00 00 00 04 00`, then 1 Hz
three-byte samples `[spo2][pulse][motion]` from offset 10. A file is complete when its 48-byte
trailer carries the sub-magic `48 12 5a da` at `trailer[4:8]`.

**[HW] End-to-end confirmed on Linux, 2026-08-30:** session `20260829225715` pulled at 682 bytes —
an exact size match — 204 samples, SpO2 95–97, pulse 57–62, trailer finalised, `total_seconds=208`,
`avg_spo2=97`, 0 desaturations.

🔴 **[SDK] Opcodes a client must NEVER emit:** `0xE3` FACTORY_RESET wipes stored recordings, and
`0xEE` FACTORY_RESET_ALL powers the ring off permanently until it is put on USB.

## 6 · The encrypted handshake — and what is still not known

**[SDK]** Newer rings answer `0xFF` with a ~20-byte blob. Cyclic-XOR it with `_LEPU`: `r[0]` is the
type (`0x01` = AES), `r[1]` the key length (16), and the AES-128 key is `r[4:4+len]`. Everything
after is AES-128-ECB with PKCS7; the `0xFF` command itself, and the envelope and CRC, stay plaintext.

**[3P]** Confirmed working against a real branch-`2D010001` ring by an independent implementation
(SomnoTrace `5e4bd0b`) — it paired, read serial and firmware, and logged a session. That confirms the
**protocol**. It is not confirmation of ours: no ring we own answers `0xFF`, so our cipher path has
never executed against hardware.

⚠️ **[HW, third-party logs] A reply is not proof of an encrypted session.** The same ring answered
with ~20 bytes on its pairing connect and with **16 bytes** on later ones — `encrypted=0` on 6 of 8
observed connects — and those plaintext sessions worked completely: serial, firmware, file list, four
file pulls. **This falsified the obvious rule.** "Any reply to `0xFF` ⇒ refuse" would have refused the
connects that moved all the data. Both clients therefore key on *too short to carry a key blob*,
which is measured, and never on *is an echo*, which is not.

**[INF] The 16-byte reply is probably an echo** of the 16-byte auth payload we send — it is the right
length. Nothing depends on this and it has never been verified.

**[INF] Only the first connect after pairing seems to offer AES.** A pattern across two nights, not a
mechanism anybody has established.

## 7 · Open questions, and what would answer each

| question | what would settle it |
|---|---|
| The actual bytes of a `0xFF` key blob — nobody has them | A USB or BLE capture against a branch-`2D010001` ring. The five preserved Discussion #180 logs do **not** contain it: every hex dump in them is `as11_ble`, the CPAP, and the ring's auth lines carry no bytes. |
| Is the 16-byte reply an echo? | The same capture. |
| Are `CsrStart`/`CsrEnd` the real event names? | A BLE capture of `TherapyEvents-RespiratoryEvents` with a CSR episode in it. If none of the four spellings match, CSL carries no CSR events at all. |
| Sample byte 2 — motion, or status flags? | A deliberate-movement pull. Two references disagree: OxyDex reads motion (×2 for CSV), `nglessner/o2ring-s-protocol` reads status flags. ~98 % of observed values are zero, which distinguishes neither. |
| Does the USB `FILE_DATA` path produce a byte-identical file to the vendor export? | A first off-body pull compared against a vendor-exported `.dat`. If the header offset differs, every sample shifts by a constant — the self-consistency check would catch it. |

## 8 · Cross-checks that agree, and one that did not

**[3P]** `nglessner/o2ring-s-protocol` (BLE) independently confirms the frame layout and CRC (its
fixture `A5 E1 1E 00 02 00 00 → BF` reproduces), the auth scheme, the 48-byte trailer and the
GET_INFO RTC field. **But both that repo and our own `oxyii` carried the `>> 0,1,2,3` timestamp
form**, which our capture refuted — agreement between two readings of the same SDK is not
independent evidence, a point worth remembering whenever two sources "confirm" each other here.

## 9 · The fixture rule this bring-up produced

⚠️ **Ask of any test double: can this fixture do something the hardware cannot?**

Three instances, all of which produced a green suite over something broken:

1. **[HW]** A `FakeDev` that answered `0xFF`. No ring we own ever does. The tests passed while the
   real client waited forever for a reply that could not come — the fixture had encoded the wrong
   contract, and the suite proved a property of the fake.
2. **[3P]** A `FakeGattClient` that answered the DIS characteristic `0x2A26`. The ring does not
   implement it at all, so a trigger built on that field could never fire. Five tests, 100 % coverage,
   all about the fake.
3. **[HW]** A `parse_dat` fixture that wrote samples straight into the trailer with no `0xFF/0xFF`
   terminator. The parser correctly decoded 16 phantom samples; the test asserted 3 against a true
   19. **The parser was right and the file was one no ring writes.**

**The general form**, worth stating because it also explains item 2: `0x2A26` is a value the ring must
*choose to expose*, and does not. A reply to `0xFF` is a *behaviour it demonstrably produces*. A
detector built on the second cannot be defeated by a missing characteristic; one built on the first is
only as real as the fake that supplies it.

