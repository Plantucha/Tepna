<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05-BRIEF.md
---
The O2Ring's `0xE1` GET_INFO reply carries a wire serial and a firmware string; `run_oxyii` read it
on every session and threw both away, so a spoofed ring (audit brief C1 — address-only identity, no
bond, public protocol) was indistinguishable from the real one on every surface the daemon exposes.

`run_oxyii` now publishes `ring_serial` / `ring_firmware` to STATUS, the webmon projection and the
monitor page, and compares the serial against a new optional `serial:` key on the O2Ring device
entry (`alerts.ring_identity_mismatch`, pure). A mismatch — including a peer that answers with no
serial at all — is journaled at ERROR on transition (not per readback), carried to the guardrails
webhook once per episode (latched on delivery, retried next poll if undelivered, cleared when the
serial matches again), and drawn as a `ring-identity-alarm` block on the monitor. Detection, not
prevention: the link is still unbonded and the reply plaintext. Inert until `serial:` is configured.

⚠ The brief's Mitigation C named the BLE-name id `S8AW2100` as the comparable field; the reply carries
the wire serial (`2592302100` on the corpus ring). The brief is corrected inline.

Tests: 17 across `test_alerts`, `test_capture_runners`, `test_webmon_state_contract` and the new
`test_monitor_ring_identity` (render executed under node, hostile serial entity-encoded). Four
plants — journal every readback, latch before delivery, never clear the latch, never compare —
each turn a named test red.
