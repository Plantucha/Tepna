<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs, capture-host]
brief: POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md
---
The onboard-recording wire format is established — and the Verity's is not PS-FTP.

§4 said "the wire format of the start op is NOT established" and planned a PS-FTP refactor plus a
narrow `_ALLOWED_QUERIES` widening. That is right for the H10 and **wrong for the Verity**, which is
the leg that matters. From `BDBleApiImpl.kt:2011`, an offline start is:

```kotlin
client.startMeasurement(type, settings, PmdRecordingType.OFFLINE, pmdSecret)
```

and `PmdRecordingType` is the whole encoding — `ONLINE(0)` / `OFFLINE(1)`, `asBitField() = numVal shl
7`, i.e. **`0x80`**. So the Verity's offline start is the ordinary PMD `START_MEASUREMENT` that
`capture.py` already sends for every live stream, with the measurement-type byte OR'd with `0x80`:
same characteristic, same client, same settings payload. **No allowlist widening and no
PS-FTP-on-the-live-client refactor for that leg** — the hardest-looking piece of the brief dissolves.

The H10 leg *is* PS-FTP: `REQUEST_START_RECORDING = 14` / `STOP = 15` / `STATUS = 16`, with
`PbPFtpRequestStartRecordingParams { sample_type = 1, recording_interval = 2, sample_data_identifier
= 3 }`. `types.proto` carries **`SAMPLE_TYPE_RR_INTERVAL = 16`**, which settles §1's tension: RR is
expressible on the wire even though the H10 product page says "HR with one second sampletime". Whether
the device accepts it stays a hardware question, but the leg is worth attempting rather than
pre-scoped to HR-only on a doc sentence.

Three findings that change the design rather than just informing it:

* **You cannot read the device while it records.** The Verity product page: *"Any file transfer is
  prohibited when Polar Verity Sense is in internal recording or swimming mode… will return
  `SYSTEM_BUSY`"* — which conflicts with the generic SDK doc ("not recommended"), and the
  device-specific page wins. So the morning pull must **stop** the recording first, and §5's
  "offline as primary" leaves the device unlistable all night. It is also a standing diagnostic trap:
  once recording is in use, `SYSTEM_BUSY` will look exactly like the §6b hang. (It was not that hang —
  that was the unpruned walk, #710, on a device holding no sessions.)
* **Triggers may remove the need to start anything over BLE.** `TRIGGER_SYSTEM_START` records on every
  power-on; set once, no runtime call. Evaluate before building the start path. `TRIGGER_EXERCISE_START`
  with PPI returns `ERROR_NOT_SUPPORTED`.
* **Memory limits (answers §6 Q2).** Limit 1 (~2 MB) → `ERROR_DISK_FULL` on start; Limit 2 → active
  recordings **auto-stop** and triggers disable. The auto-stop is §0.2's fabricated-absence case: the
  night ends early and the file still looks fine.

Also records that **there is no prior art to borrow** — BleakHeart explicitly lacks offline recording
and its author asked Polar for the packet format (`polar-ble-sdk#600`, `#556`) — and adds a
licensing improvement: **`rsc-dev/loophole` (MIT)** independently documents the same USB framing
constants the probe derived (`(len+8)<<2`, `len+4`, `[0x01,0x05,n]`), so the USB work can cite MIT
rather than only `v800_downloader` (GPL-3.0). `0da4:0008` is literally the *Loop* product id our dock
enumerates as, and loophole's `init()` has no handshake — supporting the enumeration-window finding.

Also settles the USB question §6b left open, with a clean negative: bursting requests the instant the
dock re-enumerated shows the window is **exactly one request wide** — `+0.09s` the directory listing
succeeded, `+0.30s` the 70-byte file returned nothing, and so did 38 further requests, file or
directory alike. Since a multi-packet reply obliges the host to ACK each packet and every ACK is
itself a request, nothing larger than one 64-byte report can ever complete. The "re-enumerate → one
GET" pull loop is dead; USB stays a fast lister with diagnostic value (it is how #710's unpruned walk
was found) and BLE remains the only pull path.

Docs + comment blocks only — no shipped bundle, no `manifestHash` movement, no fixture re-recorded.
