<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-21 · **Created:** 2026-08-21 · **Follows:** `RESMED-AS11-PROTOCOL-REFERENCE-2026-08-21-BRIEF.md`

# CPAP capture over BLE — pull therapy data onto the box's stratum-1 clock

**One line:** the box already pairs with the AS11 over BLE, already carries the BLE radios, and is a
**LAN stratum-1 time server** — strictly better than any external NTP bridge. This makes CPAP a
first-class, correctly-clocked BLE signal captured *on the box beside the wearables*, retiring the
ez-Share SD harvest and the RTC-drift problem for every future night. The device clock cannot be *set*
(`SetDateTime` is permission-gated off BLE — see the protocol reference §5), so the box stamps the pulled
data with its own clock and records the device's measured drift alongside.

## Why this, and why now

- **Protocol-permitted, cited.** The AS11 permission table (protocol reference §3) puts `StartSpool` /
  `PullSpoolFragments`, `StartStream`, `SubscribeEvent`, and `GetDateTime` on **`application`** access,
  which includes the encrypted BLE channel `0x0396/0x0397`. Reading therapy data over BLE is allowed.
- **Pairing is proven** on the real device (SRP-6a M2 verified), and the credentials reconnect
  passwordlessly (`RequestSession` → `CheckSessionIntegrity`).
- **The clock is better here.** SomnoTrace stamps with plain NTP on an ESP32; the box is stratum-1 and
  runs the fusion pipeline. Same job, better clock, no extra hardware.
- **It closes the drift problem at the source.** A night captured this way never carries the drifted RTC
  in its timestamps — the box's clock is the timeline, and `GetDateTime` records the offset for the record.

## Architecture — pure core in-repo, device runner as an operator probe

The BLE I/O cannot be unit-tested without the device, and capture-host enforces a 100 % coverage floor.
So the split is deliberate:

1. **`capture-host/as11_link.py` — the link layer (PURE, no BLE, no crypto dependency).** FIG framing,
   SRP-6a pairing math, session-key/proof derivation, and the RPC request builders. Uses only the standard
   library (hashlib/hmac/struct/zlib). Written FROM the published spec (protocol reference), clean-room,
   Apache-2.0 — **not** derived from the GPL SomnoTrace. Fully pytest-covered.
2. **`capture-host/as11_pull.py` — the pull orchestration (PURE, injected transport AND injected cipher).**
   `establish` (the four-step reconnect handshake, plaintext) and `pull_spool` (StartSpool →
   PullSpoolFragments loop, fragment reassembly by `seq`, Base64 decode, continuation via
   `nextSpoolAddress`, terminal-status handling) take injected async `write`/`recv_frame` callables **and a
   `seal`/`unseal` cipher pair** — so the whole state machine is testable against a fake device replaying
   canned frames, with an identity cipher, using the standard library alone. No bleak here. Fully
   pytest-covered.
3. **`cpap_ble_pull.py` — the device runner (operator probe, NOT committed / not gated).** Wires real
   bleak I/O (scan on a free adapter, connect, the encrypted send/recv) **and the real AES-256-CBC cipher**
   (length-prefixed zero-pad; `cryptography` is present on the box beside bleak) into the pure core, calls
   `GetDateTime` (record drift vs the box clock), pulls the Summary spool, and writes a stratum-1-stamped
   output. Run by the operator against the real CPAP — same home as `pair_as11.py` / `getdatetime_as11.py`
   on `/srv/tepna/probe`.

**Why the cipher is injected, not in the gated module.** AES-256-CBC is the one primitive the link needs
that is not in the Python standard library, and `cryptography` is neither installed nor a declared
capture-host dependency. Rather than add a heavyweight dependency to a gated package for a single wire
format, the cipher is dependency-injected: the pure core carries the whole protocol state machine (framing,
handshake, spool loop) with zero third-party imports and 100 % coverage, and the operator probe — which
already imports bleak and `cryptography` — binds the session key to a real `seal`/`unseal` and passes them
in. The wire cipher is validated LIVE by the probe's first encrypted `Get` (a successful `json.loads` of
the decrypted result proves every AES constant), which is the only place it can be validated without the
device anyway.

**Read-only by construction.** The link + pull layers build only read RPCs (GetDateTime, StartSpool,
PullSpoolFragments, SubscribeEvent). No state/therapy-changing method (`Set`, `SetDateTime`, `EraseData`,
`ResetDevice`, `EnterTherapy`, OTA…) is implemented anywhere; adding one must be a deliberate, separate act.

## Done when (this increment = the pull core)

- [ ] `as11_link.py` + `as11_pull.py` land with 100 % statement+branch coverage (`capture-host/check.sh`).
- [ ] The pull state machine is exercised against a fake AS11 replaying canned encrypted frames: a
      multi-fragment spool reassembles in `seq` order; a `SPOOL_COMPLETE_MORE_DATA_PENDING` round
      continues from `nextSpoolAddress`; `SPOOL_COMPLETE_NO_MORE_DATA` terminates; an `ERROR_DATA_UNAVAILABLE`
      and a decrypt failure surface as errors, never as silent empty output.
- [ ] SRP round-trip proven against a simulated device (M1/M2/K agree), matching the live pairing.
- [ ] `cpap_ble_pull.py` delivered as an operator probe; the operator's live run against the CPAP prints
      the stratum-1 timeline + measured `clock_drift`.

## Follow-ups (not this increment)

- Live-stream capture (`StartStream` → `StreamData`) for the BRP/PLD/SA2 waveforms, and `SubscribeEvent`
  for respiratory events — same encrypted channel, additional decoders.
- EDF generation from the spool/stream so CPAPDex ingests the BLE-captured night exactly like an SD night.
- Daemon integration (`capture.py`): a post-doffing CPAP-over-BLE pull, on the free adapter, gated so it
  never contends with the wearable capture.

## Deliberately NOT in scope

- **Setting the CPAP clock** — impossible over BLE (permission table); the box-clock stamp is the fix.
- **Any write/therapy RPC** — read-only by construction.
- **The encrypted *binary* NCP lane** (`0x0394/0x0395`) — the JSON lane carries everything needed.
