<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md
---

**AS11 AES-256-CBC payload cipher committed as `as11_cipher.py` (+ `cryptography` dependency).**

The stream/pull protocol layer (`as11_link`/`as11_pull`) stays stdlib-only and takes `seal`/`unseal` by
injection; until now the real cipher lived only in the un-committed operator probe. To run the CPAP
stream INSIDE the capture daemon (so the waveform reaches the monitor's bus → SSE → Live-streams grid),
the cipher must be committed, gated code — the "cipher into the daemon" path.

`as11_cipher.make_cipher(session_key)` returns the `(seal, unseal)` pair for the hardware-confirmed wire
format — `[iv:16][AES-256-CBC(len:2LE ‖ payload ‖ zero-pad)]`, length-prefixed (NOT PKCS#7), fresh IV
per seal, 32-byte key enforced. `cryptography>=42` is added to `requirements.txt` (the sole non-stdlib
primitive; `bleak`/`aiohttp` were already deps). 100% coverage, mutation-clean; cross-checked against
`as11_pull.stream` driving a real StreamData frame through the real seal/unseal so the cipher and
consumer are proven to compose. `make_cipher` is allowlisted in `find_unwired` (its consumer is the
daemon task + operator probe, same as the rest of the AS11 core). This is the foundation; the daemon
BLE task + bus wiring that actually paints the live card is the next increment.
