<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---

**Vigil monitor: a ResMed pairing button + PIN field, alongside the wearable bonding controls.**

Adds a "Pair ResMed" control to the CPAP card — a passkey input plus a button — and a `POST /api/cpap/pair`
webmon endpoint that validates the 4–10 digit passkey shown on the CPAP screen and delegates the SRP-6a
handshake to a daemon-injected `cpap_pair` coroutine (the daemon owns the radios), answering 501 when a
build has no AS11 support wired — the same seam as `ring_config`/`ring_buzz`. The pairing exchange is
plaintext SRP, so no crypto dependency enters the gated package. The daemon-side BLE handshake that
actually runs the exchange and writes `as11_creds.json` is the next increment (it needs real-hardware
validation). Groundwork for the CPAP-over-BLE capture path (see the CPAP-BLE-CAPTURE and
RESMED-AS11-PROTOCOL-REFERENCE briefs).
