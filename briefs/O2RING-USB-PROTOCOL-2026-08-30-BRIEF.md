<!--
  O2RING-USB-PROTOCOL-2026-08-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — the consolidated O2Ring-S USB + hardware protocol reference; last-verified 2026-08-30; §3.3/§9.1 AES-session addendum 2026-09-02) · **Created:** 2026-08-30

# O2Ring-S — the USB (HID) protocol, and a consolidated hardware reference

> **What this is.** The single entry-point reference for the Wellue **O2Ring-S** hardware: both wire
> transports (BLE and the newly-cracked **USB/HID**), the shared frame codec, the authentication gate,
> the full opcode surface, the stored `.dat` recording format, and the live optical streams — plus the
> **reverse-engineering process** that produced the USB crack on 2026-08-30, because *how* it was done is
> the part that keeps being re-learned. Deeper single-topic detail lives in the briefs cross-referenced at
> the end; this doc is the map. Code of record: `capture-host/oxyii.py` (BLE codec + parsers),
> `capture-host/o2ring.py` (USB client), `capture-host/parse_dat.py` (recording decoder).

---

## 1 · Device identity

| | |
|---|---|
| Model | Wellue **O2Ring-S** (Viatom/Lepu "OxyII" family; MCU nRF52840, AFE TI AFE4403) |
| USB | **VID `0x1915` / PID `0xF33C`** — one HID interface, vendor usage page `0xFF00` |
| BLE | addr `D1:98:62:7C:92:B3`; advertised name-id `S8AW2100` (used in filenames) |
| Serial / fw | wire serial `2592302100`, firmware id `2D010002` (ASCII, in the GET_INFO reply) |
| Vendor app | **O2 Insight Pro** V1.8.14 (Qt5/C++; uses `hidapi.dll` for the O2Ring-S) |

⚠️ The BLE **name-id** (`S8AW2100`) and the **wire serial** (`2592302100`) are different identifiers — do
not conflate them. The auth uses neither by default (see §4).

---

## 2 · Two transports, one frame

The device speaks the **same OxyII frame** over BLE and USB; only the outer wrapper differs.

### 2.1 · BLE (OxyII)
- Service `e8fb0001-…`, write-without-response char `e8fb0002-…`, notify char for replies. Unbonded.
- The device **splits large live frames across multiple notifications** — `oxyii.Reassembler` accumulates
  notification bytes until a full declared `0xA5` frame is buffered. (This is the same multi-part shape
  the USB path hits at the report level — see §2.2 and §9.)

### 2.2 · USB (HID) — cracked 2026-08-30
- **HID over the CONTROL endpoint out, interrupt-IN back.** Commands go OUT as **SET_REPORT**
  (`bmRequestType 0x21`, `bRequest 0x09`, control ep `0x00`); replies come IN on the **interrupt-IN
  endpoint `0x81`** as 64-byte reports. **GET_REPORT / feature reports STALL** (EPIPE) — the ring does not
  support them.
- **64-byte reports, no report IDs.** On Windows/`hidapi` prepend a `0x00` report-id byte (writes become
  65 bytes on the wire).
- **The report is length-prefixed:** `[len][ frame bytes ][crc]`, zero-padded to 64, where **`len` =
  `len(body)+1`** (it counts the body and the trailing CRC) and **the `len` byte is NOT covered by the
  CRC.** This last fact was the single thing that made the checksum look "unknown" in early probing (§8).
- **A reply frame larger than one 64-byte report spans multiple reports** and must be reassembled at the
  report level before decoding (§9). Confirmed with a real 74-byte FILE_LIST reply across two reports.

### 2.3 · The frame body (between `len` and `crc`)
```
magic | op | ~op & 0xFF | flag | seq | len_lo | len_hi | payload…
```
- `magic` = `0xA5` (or `0xAA`, a legacy variant — both accepted).
- `~op` is the one's-complement check byte; `len_lo/len_hi` is the u16 payload length.
- **CRC = CRC-8/SMBUS** (poly `0x07`, init `0x00`, no reflect in/out, no xorout), computed over the
  **body only**. Single-sourced as `oxyii.crc8`. Verified against 10 captured frames plus three
  independent public references (nglessner `A5 E1 1E 00 02 00 00 → BF`; ecostech `AA 17 E8 … → 1B`).

---

## 3 · Authentication — fire-and-forget, and the HELLO reply is the success signal

🔴 **AUTH (op `0xFF`) is FIRE-AND-FORGET on our firmware (`2D010002`) — it produces ZERO replies.**
(**Newer firmware answers AUTH with a session key and switches to AES — see §3.3.**) The success ("two-arrows")
signal is an incoming **HELLO (`0xE0`) reply** (`08 a5 e0 1f 01 00 00 00 34`). So the handshake is NOT
"send AUTH, read an AUTH reply" (that reply does not exist — the trap that made every prior client
appear to hang). It is: **send AUTH `a5`+`aa` + legacy poll (`aa 15`) + HELLO (`a5 e0`) every ~1 s in a
loop, read `0x81`, and return once a `0xE0` arrives** — then GET_INFO / FILE_LIST / pull flow. See
§8 for the operational reality (it is stochastic and requires a fresh enumeration + an *awake* ring).
`o2ring.authenticate()` implements exactly this; a client that reads `want_op=OP_AUTH` can never return.

The 16-byte auth payload is built from a fixed salt, the serial, and a timestamp, then XOR-masked with
the salt (`oxyii.auth_payload` / `oxyii.auth_frame`):

```
_LEPU      = md5(b"lepucloud")                 # fixed 16-byte constant (Lepu Medical = OEM)
key[0:8]   = _LEPU[0,2,4,…,14]                 # the EVEN-indexed bytes of _LEPU
key[8:12]  = serial ASCII                      # vendor app uses the portable default "0000"
key[12:16] = struct.pack("<I", int(time.time()))   # plain little-endian uint32 of current unix time
payload    = bytes(a ^ b for a,b in zip(key, _LEPU))
```

- **Generate fresh each session** — a captured frame's timestamp goes stale.
- **The serial `"0000"` authenticates any device** (the vendor app uses it); the real wire serial works too.

### 3.1 · 🔴 The timestamp encoding — a bug shared by every prior implementation, corrected here
The `key[12:16]` field is a **plain little-endian uint32**. Three independent implementations had it
wrong as a bit-shift `key[12+n] = (ts >> n) & 0xFF` for `n=0,1,2,3`:

| implementation | encoding |
|---|---|
| our `oxyii.py` (pre-fix) | `>> 0,1,2,3` ❌ |
| nglessner/o2ring-s-protocol | `>> 0,1,2,3` ❌ |
| ilyakruchinin/SomnoTrace (even comments it "not LE bytes") | `>> 0,1,2,3` ❌ |
| **our USB capture → the fix** | LE uint32 `>> 0,8,16,24` ✅ |

The vendor-app USB capture is the **sole source** that settled it. The discriminator: over a short window
`key[13]` is *constant* under LE but ticks every 2 s under `>>n`; the capture showed `key[13:16]` constant
at `2e 94 6a` with only `key[12]` moving — and those high bytes decode as an LE epoch to the actual
capture wall-clock time (2026-08-30 09:2x), which a wrong encoding cannot do by accident.

⚠️ **Why it never broke anything — the puzzle worth saving the next reader:** our BLE auth worked for
months with the wrong bytes, which proves **the ring does not strictly validate this field** — it
tolerates it as a loose nonce. That is exactly why a real encoding bug hid behind a passing link and a
confident "faithful port" comment. Fixing it is correspondingly low-risk (the ring accepted arbitrary
bytes there). The fix landed as the `oxyii.auth_payload` correction; the USB client (`o2ring.py`) carries
it by construction.

### 3.2 · Test vectors (verify a generator offline, no hardware)
| ts (unix) | magic | first 25 bytes of the padded report |
|---|---|---|
| `1788096060` | `0xAA` | `18 aa ff 00 00 10 00 00 68 15 88 72 09 1c b0 98 c8 c7 da f8 6d a1 99 b4` |
| `1788095920` | `0xA5` | `18 a5 ff 00 00 10 00 00 68 15 88 72 09 1c b0 98 c8 c7 da 74 6e a1 99 25` |

(`len = 0x18 = 24`: 7-byte header + 16-byte payload + 1 CRC. The two frames differ only in `magic`, the 4
timestamp bytes, and the CRC.)

### 3.3 · 🔴 Newer firmware: AUTH is answered with a session key and the link goes AES (added 2026-09-02)

**Source:** the official Lepu Android SDK `lepu-blepro-1.3.9.aar` (R8-obfuscated; from
`viatom-develop/LepuDemo` `app/libs/`), disassembled 2026-08-30. This is **SDK-verified, not
hardware-verified** — our ring (`2D010002`) is old firmware and still runs the §3 plaintext path. The
trigger was SomnoTrace Discussion #180 (a user's newer O2Ring-S returning a "garbage serial" to the
plaintext SomnoTrace client); the diagnosis is posted at
<https://github.com/ilyakruchinin/SomnoTrace/discussions/180#discussioncomment-18247853>.

**The handshake (VERIFIED in the SDK):**
- The ring replies to the plaintext AUTH with a `0xFF` frame whose `flag` byte == `1`, payload ≥ 20 bytes.
  `r = payload XOR _LEPU (cyclic, 16-byte period)`; `r[0]` = type, `r[1]` = key length (16), **`key =
  r[4:4+klen]`**. The SDK arms a 1000 ms timer at AUTH; **no key reply within it → stays plaintext** (that
  is the old-firmware path, unchanged).
- Once keyed, **every command payload except AUTH is `AES/ECB/PKCS5Padding`-encrypted** with that key
  (`doad/ifgj.doab`: `if key.length != 0 → encrypt`, with **no data-length check, so an empty payload
  becomes one 16-byte block**). Header unchanged (`magic | op | ~op | flag | seq | len_lo | len_hi`),
  `len` = ciphertext length, CRC over the body as before. **Replies are decrypted the same way**
  (`doaj/doaf.doa` = `Cipher` mode 2; on any exception the SDK returns an empty array).
- The #180 symptom follows directly: a plaintext-only client's requests are ignored or answered in
  ciphertext (a 31-byte GET_INFO reply comes back as 32 opaque bytes → "garbage serial").

**INFERRED (not in the SDK, not testable on our hardware):**
- that the ring answers **every** AUTH with a key reply — hence a keyed client must **stop re-sending
  AUTH** (re-key risk; the §3 hello-loop repeats AUTH every ~1 s);
- whether the `0xE0` HELLO ack is present and/or encrypted on new firmware;
- that the legacy `0x15` poll is encrypted once keyed (the SDK rule applied literally).

**Implementation of record — `capture-host/o2ring.py` (USB client, landed 2026-08-30, untracked):**
pure-Python AES-128/192/256 ECB + PKCS5 (FIPS-197 C.1/C.2/C.3 + Appendix B vectors; byte-identical to
`cryptography`/OpenSSL for 16/24/32-byte keys, 0–512-byte data); module-level `SESSION = Cipher()`
(`key None` = plaintext); `send_cmd()` wraps every non-AUTH payload when keyed; `read_reply()` unwraps
(pass-through when not a 16-multiple/empty; bad padding → warn + raw + error count);
`authenticate()` inspects every frame, installs the key from the `0xFF flag==1` reply, stops sending
AUTH, immediately sends an encrypted HELLO, returns on the HELLO ack, and after `keyed_grace_s=5 s`
without one proceeds on the key reply (flagged as the unverified path). Old-firmware behaviour is
unchanged. Acceptance test (`tests/test_o2ring.py`): a stateful `FakeRing` built from the **SDK logic,
not from the client** (`encrypted=False/True`; keyed requests must decrypt or are ignored; plain
requests and AUTH-after-key are counted) — **the same recording pulled from the plaintext ring and the
encrypted ring must be byte-identical with identical request logs**, `bad_requests == 0`,
`auth_after_key == 0`; plus a #180-symptom test (plaintext-only client → silence, then 32-byte
ciphertext). rig-x870: 64 passed; Windows: 87 passed / 1 skipped (`cryptography` absent).

---

## 4 · Opcode surface

Documented core: `0xFF` AUTH · `0x10` SETUP · `0x04` LIVE_SAMPLES · `0xC0` SET_UTC_TIME · `0xF1`–`0xF4`
file ops. A 256-opcode sweep found **25 undocumented responders** (`O2RING-OPCODE-SURFACE`). The ones that
matter for a client:

| op | name | notes |
|---|---|---|
| `0xE0` | hello | USB identify; empty-payload ack |
| `0xE1` | GET_INFO | serial + RTC (§5) |
| `0x00`/`0x01` | GET_CONFIG / SET_CONFIG | 40-byte config struct (alarms, brightness, storage interval) |
| `0xE4` | GET_BATTERY | battery state/level |
| `0x03` | LIVE_PPG_A | single-channel pleth drain; **caps 250 samples ≈ 2 s, silently drops overflow** |
| `0x05` | GET_RT_PPG | two-channel raw red/IR (§7); needs args `{0x07, 0x01}` |
| `0x83` | VIBRATE | motor buzz (~1.1 s); the ring also self-buzzes on lost contact |
| `0x15` | poll (legacy `0xAA` frame) | device-detection keepalive |

🔴 **NEVER emit `0xE3` (FACTORY_RESET — wipes settings + recordings) or `0xEE` (FACTORY_RESET_ALL — powers
off permanently until USB).** The USB client hard-denies these on its raw `replay` path and skips them in
the `--sweep` probe. A blind opcode sweep can still hit *unknown* state-changing ops — the client warns
before sweeping.

---

## 5 · GET_INFO (`0xE1`) and the RTC

The ~60-byte reply carries firmware id + wire serial (ASCII), and a **readable RTC** at `payload[24:31]`:
```
year (u16 LE) · month · day · hour · minute · second      # LOCAL CIVIL time, stored verbatim
```
Example `… ea 07 08 1e 09 15 0e …` → `2026-08-30 09:21:14` **local**. This is the read side of the `0xC0`
SET_UTC_TIME write (same layout). **Store/parse it as local civil — no timezone conversion** (Clock
Contract). The RTC free-runs and drifts (~+151 s measured); `0xC0` disciplines it to the host.

---

## 6 · Stored recording — "Format-A" `.dat`

The onboard recording (also what a USB file-pull returns) is compact and self-describing:
- **10-byte header** (`01 03 00 00 00 00 00 00 04 00` on the sampled device), no absolute time — the start
  instant comes from the `YYYYMMDDhhmmss` session-id / filename, never a fabricated `now()`.
- **Sample region: 3-byte records at 1 Hz** from offset 10 — `[SpO2 % u8][pulse bpm u8][motion u8]`. **No
  waveform is stored** (raw PPG is live-only, §7). An off-finger second shows SpO2 outside `50..100`.
- **Terminator:** the first record with `SpO2 == 0xFF && pulse == 0xFF`.
- **48-byte trailer**, marked by sub-magic **`48 12 5A DA` at `trailer[4:8]`** (the reliable "complete"
  flag — file size alone is not). Fields: `total_seconds` `[12:14] u16 LE` · avg SpO2 `[34]` · min SpO2
  `[35]` · desat≥3% `[36]` · desat≥4% `[37]` · seconds<90% `[39:41] u16 LE` · episodes<90% `[41]` · O2
  score×10 `[42]` (`0xFF`=n/a) · avg HR `[47]`.
- **Built-in regression:** trailer avg SpO2 / avg HR agree with the body means to **±1**, and
  `total_seconds ≈ record count` — so a clean decode validates its own header offset and record layout
  with no golden fixture. (`parse_dat.self_consistency`.)

⚠️ **`byte 2` label is unsettled:** OxyDex treats it as **motion** (and runs a validated motion pipeline
on it — WASO, sleep-quality, a stuck-column fault detector), while nglessner calls it a **status flag**.
The `.dat` byte is 94–98 % zero on real nights, which fits both. Kept as "motion" for OxyDex-CSV
compatibility, with the conflict documented; settle it on a resting off-body pull (does it track movement,
or stay ~0 through movement).

---

## 7 · Live optical streams

Two distinct raw streams, **live-BLE/USB only** (neither is in the stored `.dat`):

### 7.1 · The pleth — single-channel finger PPG (`0x04` body / `0x03` drain)
Each live `0x04` reply = 24-byte status header (`oxyii.parse_live`: SpO2`[6]`, contact`[5]`, PI`[7]÷10`,
motion, battery) **then** a raw PPG body. Body layout (`oxyii.parse_ppg`): sample count `u16 LE` at
`[24:26]`, then `N` `u8` samples, single channel. **Rate 125.738 Hz.** Two gotchas: `156` (`0x9C`) is the
in-band **PPG_INVALID** sentinel (reject on value AND isolation; treat as a gap, never median-fill), and
the stream is **inverted** vs the vendor display (`127 − sample`). Pulse rate matched paired ECG to ~0.2
bpm on a real capture.

### 7.2 · The raw dual-wavelength stream — `0x05`, the "ppg2 mystery"
First concluded **absent** — a decode failure: the opcode sweep scored `0x05`'s fixed 922-byte reply with
a *generic noise metric* over undifferentiated bytes, which cannot see structure. Corrected 2026-08-05:
read as **9-byte records `{u32 ch0, u32 ch1, u8 motion}`**, both channels are ordered waveforms
(successive-|Δ|/range ≈ 0.015 vs 0.34 shuffled — 23× rougher, i.e. structured and temporal).
**IR = ch0, RED = ch1**; args `{0x07, 0x01}`; double-poll to avoid ~18 % loss. Ratio-of-ratios over the
two channels reproduces the ring's reported SpO2 (`O2RING-WAVEFORM-SPO2-SHIP`, DONE). **Lesson (general):
a sweep's negative means "no structure my decoder could see", never "no capability".**

---

## 8 · The reverse-engineering process — how the USB crack was actually done

The value here is the *sequence*, because three of its steps produced confident wrong conclusions first.

1. **Direct Linux `hidraw` probes → a constant idle `05 00 00 00 00 05`, unchanged by any command.**
   Concluded "the ring stonewalls." **Wrong:** it was refusing *un-authenticated* commands (§3). No auth
   was being sent, so nothing answered.
2. **usbmon capture under Wine → the vendor app authenticated but reported "No device connected".** Every
   `GET_REPORT` returned 0 bytes. **The block was the read path:** Wine's HID relay could not read the
   interrupt-IN endpoint, so the app never saw the ring's replies. This looked exactly like a dead device
   and is the single most misleading failure mode on this hardware.
3. **Real Windows USBPcap → a *successful* end-to-end exchange** (`usb_o2_ring_dump.pcapng`). Real Windows
   (and real Linux) read interrupt-IN `0x81` directly, so the replies arrive. This one capture resolved
   the auth gate, the framing, and the file-list flow at once.
4. **Auth solved by differencing six timestamp-varied frames.** The payloads differed only in ~1–2 bytes +
   the checksum; diffing constant-vs-varying isolated the timestamp field, which decoded as a **plain LE
   uint32** — refuting the `>>0,1,2,3` shift every prior implementation had guessed (§3.1).
5. **Checksum solved by fixing the coverage, not the algorithm.** It is ordinary CRC-8/SMBUS; the earlier
   miss included the `[len]` byte in the CRC input. Excluding it (body-only) reproduces every frame.
6. **`.dat` decoder ported** from OxyDex's shipping `decodeO2RingBinToCSV` + `oxyii.parse_oxy_trailer`,
   with the trailer↔body self-consistency check as the regression (no golden needed).
7. **Cross-validated against three public references** (nglessner protocol repo, ecostech viatom-ble,
   ilyakruchinin/SomnoTrace) — all independently confirmed the frame envelope, CRC, auth construction,
   trailer and RTC, and **all three carried the same `>>0,1,2,3` timestamp bug**, which makes our capture-
   derived LE fix a genuine contribution back.

### 8.1 · Methodological lessons (transferable past this device)
- **A passing link can hide a real bug** when the field is a loose nonce (the auth timestamp). "It works"
  is not "it is correct."
- **A sweep's negative is decoder-shaped**, not capability-shaped (the `0x05` two-channel stream read as
  noise under a byte-wise metric).
- **The two test files together are the spec** — a fix passed one suite 8/8 while breaking a case only the
  other file pinned (see the capture-host `classify_failure`/`ble_discovery` work of the same period).
- **A real fixture beats a synthetic one:** the byte-for-byte auth vectors and the real `.dat` trailer
  self-check validate the whole chain in a way no hand-built fixture could.

---

## 9 · Known-open / confirm-on-hardware

- **FILE_DATA reply chunk framing.** The file-transfer request opcodes are known (FILE_LIST `0xF1` →
  `[count u8][16-byte slots: 14-char `YYYYMMDDhhmmss` + 2 pad]`; FILE_START `0xF2` payload `ts14 + 00 00 +
  ftype u32 LE`, reply carries file size `u32 LE` at `[0:4]`; FILE_DATA `0xF3` payload `offset u32 LE`;
  FILE_END `0xF4`). The exact per-reply chunk size and whether it re-echoes the offset need a **real
  off-body pull** to confirm (the crack capture was taken worn, so it holds no FILE_START/DATA — the ring
  **refuses FILE_START while worn**, FILE_LIST still answers).
- **Multi-report reassembly** at the USB report level (a reply frame > 55 payload bytes spans reports) —
  implemented against a real 74-byte 2-report FILE_LIST specimen; re-confirm on the first large file pull.
- **`byte 2` of the `.dat` sample record** — motion vs status flag (§6).
- **The auth timestamp validation strictness** — characterized only enough to say "generate current unix
  time and it authenticates" (loose nonce); the exact tolerance window is unmeasured.
- **The §3.3 AES session on real new-firmware hardware** — the whole encrypted path is SDK-verified and
  fake-ring-tested only; the three INFERRED items in §3.3 need one new-firmware ring to settle.

### 9.1 · Work-unit — BLE `oxyii.py` port of the §3.3 AES session (capture-host lane; queued 2026-09-02)

**Why it exists as a brief before it exists as code:** our hardware cannot exercise the encrypted path,
so the port is specified here and picked up when the queue allows. **Trigger to move it up:** any ring
in the fleet reporting firmware newer than `2D010002` (or any BLE session where AUTH comes back with a
`0xFF flag==1` frame). Reference implementation to lift from: `capture-host/o2ring.py`
(`aes_ecb_encrypt/decrypt`, `parse_key_reply`, `Cipher`, the `authenticate` loop) — the AES and
key-reply code is transport-independent and can be moved into `oxyii.py` verbatim.

**Requirements (VERIFIED in the SDK):**
1. Parse the `0xFF flag==1` AUTH reply: `r = payload XOR _LEPU` cyclic, `klen = r[1]` (accept 16/24/32),
   `key = r[4:4+klen]`; reject anything shorter than 20 bytes or with a non-AES key length.
2. Once keyed, `AES/ECB/PKCS5Padding` **both directions** for every op except AUTH; empty payloads encrypt
   to one 16-byte block; `len` = ciphertext length; on undecryptable/badly-padded replies warn and hand
   the raw bytes up, never silently drop.
3. **Fall back to plaintext** when no key reply arrives within ~1 s of AUTH (old firmware — every ring we
   own today). Old-firmware behaviour must be byte-for-byte unchanged.

**Requirements (INFERRED — implement defensively, mark in code):**
4. **Do not re-send AUTH once keyed** (assumed re-key on every AUTH). The BLE client's current retry
   shape must be checked for this.
5. Treat the HELLO `0xE0` ack as optional and possibly encrypted after keying: try to decrypt, accept
   plaintext, and proceed on the key reply alone after a short grace if no ack arrives.
6. Encrypt the legacy `0x15` poll like any other op once keyed.

**Acceptance bar (no pinned constants — the Tepna oracle lesson):** a stateful fake ring built from the
SDK rules, not from the client; **differential test** — the same recording pulled through
`encrypted=False` and `encrypted=True` fakes must produce byte-identical `.dat` output and identical
request logs (minus HELLO/`0x15` chatter), with zero plaintext requests after keying and zero AUTH
re-sends; a #180-symptom test showing the *pre-port* client fails against the encrypted fake; the
`Reassembler` path (§2.1) exercised with ciphertext frames ≥ 2 notifications. Reuse
`capture-host/tests/test_o2ring.py::FakeRing` as the template.

---

## 10 · Cross-references

Deeper single-topic detail:
- `O2RING-PROTOCOL-2026-07-17-BRIEF.md` — the original BLE-era OxyII protocol reference (`§3b` = the
  canonical live-PPG + `.dat` byte layouts).
- `O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md` — the 256-opcode sweep + the read-surface byte map.
- `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md` — the single-channel pleth capture (§7.1).
- `O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md` (+ `-FOLLOWUPS`) — the `0x05` two-channel stream (§7.2);
  supersedes `O2RING-RAW-STREAMS-ABSENT-2026-08-04-BRIEF.md` (the wrong negative).
- `O2RING-WAVEFORM-SPO2-SHIP-2026-08-20-BRIEF.md` — SpO2 from the two channels.
- `O2RING-RTC-…` / `o2ring-rtc-is-readable` — the RTC read surface (§5).
- Lepu SDK `lepu-blepro-1.3.9.aar` (`viatom-develop/LepuDemo` `app/libs/`) — the source for §3.3; the
  relevant classes after R8 are `doad/ifgj` (frame builder, encrypt-if-keyed) and `doaj/doaf` (AES helper).
- SomnoTrace Discussion #180 — the field report that surfaced the AES session (§3.3, §9.1).

Code of record: `capture-host/oxyii.py` (BLE codec, `crc8`, `auth_payload`/`auth_frame`, `encode`,
`decode`, `Reassembler`, `parse_live`, `parse_ppg`, `parse_get_info`, `parse_oxy_trailer`, file-frame
builders) · `capture-host/o2ring.py` (USB HID client) · `capture-host/parse_dat.py` (Format-A decoder).

<sub>Measured on O2Ring-S (VID `0x1915`/PID `0xF33C`, fw `2D010002`) via USBPcap of O2 Insight Pro V1.8.14;
auth generator verified byte-for-byte against 6 timestamp-varied captured frames + the live command frames;
CRC and codec cross-validated against nglessner/o2ring-s-protocol, ecostech/viatom-ble, ilyakruchinin/SomnoTrace.</sub>
