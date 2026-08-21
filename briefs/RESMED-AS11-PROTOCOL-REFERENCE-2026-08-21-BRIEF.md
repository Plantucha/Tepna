<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-08-21) · **Created:** 2026-08-21

# ResMed AirSense 11 — protocol reference (BLE, RPC, EDF)

Single-page reference for the ResMed AirSense 11 (AS11) protocols Tepna touches: the BLE transport +
crypto, the RPC command layer with its permission table, and the on-card EDF formats. It exists so the
next person does not re-derive any of this, and so every claim carries its source.

## Provenance & licensing (read first)

- **Documentation source:** `m-kozlowski/airbreak-plus` `docs/as11/` — a ResMed firmware-mod + protocol
  project, fork of `Asmageddon/airbreak-plus`, descending from **`osresearch/airbreak`** (the original,
  Trammell Hudson). These are prose/table **specifications**, not code.
- **Tepna's implementation is clean-room, Apache-2.0.** `capture-host/as11_link.py` (when landed) is
  written FROM the published spec, not derived from any GPL code. This matters:
  **SomnoTrace (`ilyakruchinin/SomnoTrace`) is GPL-3.0**; a GPL-derived module could not enter this
  Apache-2.0 tree (CLAUDE.md §📜). SomnoTrace was the original *pointer* to the protocol and is credited
  in early exploration only; nothing GPL is incorporated.
- **No firmware modification** is performed or implied anywhere. Tepna reads; it does not patch the device.

## 1 · BLE transport

- **GATT service `0xFD56`.** TX char `a6220002-35f1-4b20-afae-cb089d2044aa` (write, host→device); RX char
  `a6220003-…0003…` (notify, device→host). Confirmed live on device `ResMed 590541`.
- **FIG framing** (every packet):
  `[sync:4 LE = 0xCAFEBABE][vcid:2 LE][len:2 LE][payload_crc32:4 LE][header_crc32:4 LE][payload]`.
  CRC-32 is IEEE (`zlib.crc32`); the header CRC covers the 8 header bytes only. Packets are chunked into
  `MTU−3` ATT Write Requests (opcode 0x12); the AS11 supports MTU 247. **Never** use Write Long.
- **VCIDs** (odd = host→device request, even = device→host response):

  | Request / Response | Role |
  |---|---|
  | `0x0393` / `0x0392` | BLE **plaintext** JSON — pairing + session establishment only |
  | `0x0397` / `0x0396` | BLE **encrypted** JSON — application RPC (Get, GetDateTime, streams, spools) |
  | `0x0395` / `0x0394` | BLE encrypted **binary NCP** (small lane — Tepna does not use) |

## 2 · Pairing (SRP-6a) & the encrypted session

- **Group:** RFC 5054 2048-bit `N`, `g = 2`, SHA-256 throughout. `pad(x)` = big-endian to the 256-byte
  modulus width. `H(...)` = SHA-256 over concatenated bytes.
- **First pairing** (plaintext `0x0393`): `StartKeyExchange{clientPk = pad(A) hex}` →
  device returns `{serverPk = pad(B), salt}` and **shows a 4-digit passkey on its LCD**; then
  `ConfirmKeyExchange{clientConfirmation = M1}` → device returns `{clientId, serverConfirmation = M2,
  nonce}`. Store `clientId` + `K` (the 32-byte master pair key). Verify M2 before saving.
  - `k = H(pad(N)‖pad(g))` · `x = H(salt_raw ‖ H(passkey))` · `u = H(pad(A)‖pad(B))` ·
    `S = (B − k·g^x)^(a + u·x) mod N` · `K = H(pad(S))` ·
    `M1 = H((H(pad(N)) ⊕ H(pad(g))) ‖ salt_raw ‖ pad(A) ‖ pad(B) ‖ K)` · `M2 = H(pad(A)‖M1‖K)`.
  - Note `x` uses `H(salt ‖ H(passkey))` — **no username** in `x` (differs from stock RFC 5054).
- **Reconnect** (passwordless): `RequestSession{clientId}` → `{challenge, nonce}`;
  `CheckSessionIntegrity{response = HMAC-SHA256(K, challenge) hex}` → `{confirmation:true}`.
- **Session key:** `session_key = SHA256(K ‖ nonce_raw)` (32-byte AES-256 key, one per connection).
- **Encrypted payload** (VCID `0x0397`/`0x0396`):
  `[iv:16 random][ AES-256-CBC( [payload_len:2 LE][json][zero-pad to 16-byte boundary] ) ]`.
  **Length-prefixed zero-pad — NOT PKCS#7.** Decryption reads the length and ignores padding.
- **Status:** pairing PROVEN on the real device (SRP M2 verified); `as11_link.py` self-test (25 checks)
  reproduces the full exchange against a simulated device. The encrypted read path is implemented but not
  yet run end-to-end against hardware.

## 3 · RPC layer

- **Message format:** requests are UTF-8 JSON, `jsonrpc` = the method's contract version (per-method, NOT
  interchangeable). Responses use `jsonrpc:"2.0"` and echo `id`. `params` is **omitted** for no-arg
  methods — an omitted member, `{}`, and `null` are all distinct to this firmware. Names are case-sensitive.
- **Permission table** — a firmware bit per channel decides whether a command is accepted. Access sets:

  | Access set | Permission VCIDs (channels) |
  |---|---|
  | **all** | CAN + cellular + **BLE plaintext + BLE encrypted** |
  | **application** | CAN + cellular + **BLE encrypted** (`0x0394/0x0396/0x0398`) |
  | **service** | CAN (`0x0380/0x0382`) + internal/cellular (`0x0780/0x0788`) — **NO BLE** |
  | **BLE plaintext** | `0x0390/0x0392` |
  | **BLE encrypted** | `0x0394/0x0396/0x0398` |

- **Methods Tepna cares about** (cmd · version · access):

  | Method | Cmd | Access | Reachable over BLE? | Use |
  |---|---|---|---|---|
  | `GetDateTime` | 0x04 | **all** | ✅ encrypted | read device clock → measure drift |
  | `GetRtcAndSystemClocks` | 0x47 | service | ❌ | (RTC + hi-res clock; service-only) |
  | `Get` | 0x43 | application | ✅ | read settings/profiles/data items |
  | `StartStream` / *StreamData* | 0x13 | application | ✅ | **live BRP/PLD/SA2 waveforms over BLE** |
  | `StartSpool` / `PullSpoolFragments` | 0x5e/0x5f | application | ✅ | **stored summary/detail spools over BLE** |
  | `SubscribeEvent` / *EventNotification* | 0x3a | application | ✅ | live respiratory events |
  | `GetVersion` | 0x06 | all | ✅ | identification + advertised RPC map |
  | **`SetDateTime`** | 0x05 | **service** | **❌ NO BLE VCID** | — see §5 |
  | `Set` | 0x44 | application | ✅ (write) | **not used** — Tepna never writes settings |
  | `EraseData`,`ResetDevice`,`EnterTherapy`,`ApplyUpgrade`,… | — | app/service | — | **never built** (state/therapy-changing) |

- `GetDateTime` request: `{"jsonrpc":"1.0","method":"GetDateTime","id":N}` (no `params`);
  result: `{"dateTime":"2026-08-12T14:25:31.000Z"}` — **ISO 8601 string, not epoch**.
- `StartStream`: `dataIds` (1–30), `sampleIntervalMs` (10–65000), `reportIntervalMs` (≤ 5× sample).
  BRP flow/pressure = `PatientFlow`/`MaskPressure` at 40 ms; SA2 = `SpO2`/`HeartRate` at 1000 ms.
- `StartSpool` selects one spool type by `spoolAddress.<type>.fromDateTime` (ISO 8601);
  `PullSpoolFragments` returns Base64 `SpoolFragment` notifications, continued via `nextSpoolAddress`.
- **Error codes:** standard JSON-RPC (`-32700`…`-32603`) plus `-11201 InvalidObject`,
  `-11202 SettingApplicationFailure`, and the OTA `-1130x` family.

## 4 · On-card EDF formats (the SD-harvest path Tepna uses TODAY)

Independent of BLE — this is what `cpapdex-edf.js`/`cpapdex-dsp.js` parse off the harvested card.

- **Fixed header** (`edf_header.md`): normal 256-byte EDF; recording-ID field carries
  `Startdate DD-MMM-YYYY … SRN=<serial> MID=<n> VID=<n>`. `STR.edf` uses this too (decoded in #1618).
- **Sampled signals** (`edf_signals.md`): `BRP.edf` (40 ms — `PatientFlow`, `MaskPressure`),
  `PLD.edf` (2000 ms — pressure/leak/resp/tidal/minute-vent/snore/flow-lim), `SA2.edf`
  (1000 ms — `SpO2`, `HeartRate`/`Pulse`), plus `STR.edf` daily summary (78 signals, per #1618).
- **Annotations** (`edf_annotations.md`): `EVE.edf` (respiratory events) + `CSL.edf` (Cheyne-Stokes
  intervals) share an `EDF+D` two-signal container (768-byte header, `EDF Annotations` + `Crc16`, 64 B/rec).
  EVE labels include `Apnea`/`ObstructiveApnea`/`CentralApnea`/`Hypopnea` with matching `*End` labels,
  and **`Arousal`** (which `cpapdex-dsp.js:eveClassToType` does not currently map — a flagged follow-up).

## 5 · The clock verdict (definitive)

**The AS11 date/time CANNOT be set by Tepna.** `SetDateTime` is `service` access = CAN + internal/cellular
VCIDs only, with **no BLE VCID** — so the firmware permission table refuses it over Bluetooth regardless
of pairing. The only paths that reach it are the vendor cloud (cellular `service` channel) and a physical
CAN tap; the LCD menu exposes time-zone only; firmware patching is excluded by rule. This is why the
device drifts unboundedly when its cellular link is not syncing, and why the **data-side correction**
(`fitClockOffsetSegments`, `CPAP-CLOCK-LONGITUDINAL-SEGMENT`) is the only available fix. `GetDateTime` IS
readable over BLE, so the drift can be *measured* live even though it cannot be *corrected* on-device.

## 6 · What this unlocks (and what is deliberately not built)

- **Reachable & wanted:** live waveform + spool + event capture over BLE (all `application` access) →
  the vigil box, already paired and already carrying BLE radios, could capture CPAP on its own NTP clock
  with **no additional hardware**, retiring the ez-Share SD harvest and the RTC-drift problem for future
  nights. This is a substantial separate work-unit (encrypted-channel read implementation) — spec-clear,
  not yet built.
- **Never built:** every state/therapy-changing method (`Set`, `SetDateTime`, `EraseData`, `ResetDevice`,
  `EnterTherapy`, `ApplyUpgrade`, the bootloader/OTA/CAN surfaces). `as11_link.py` is read-only by
  construction; adding a write method must be a deliberate, separate act.
- **Docs not needed:** `conf_block_format`, `bootloader_service_protocol`, `ota_protocol`, `patch_*`,
  `can_connection`/`can_protocol`, `ncp_protocol`, `power_supply_detection`, `custom_settings` — firmware
  modding, OTA, CAN hardware, or the binary NCP lane Tepna does not use.

## Related

- `CPAPDEX-STR-SUMMARY-INGEST-2026-08-21` — the STR.edf ingest (shipped from the var-reference map).
- `CPAP-CLOCK-LONGITUDINAL-SEGMENT-2026-08-21` — the step-aware data-side clock correction.
- `capture-host/as11_link.py` — the clean-room BLE link layer (pairing + encrypted session, read-only).
