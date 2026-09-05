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

**Clause 2 — the same mitigation from the other side: connects that reach identity and deliver
nothing.** Clause 1 asks whether the peer says the right serial; this asks whether it does the right
thing. A peer that answers `0xE1` and then never sends a decodable frame is not a ring doing its job —
the real one talks whether or not it is worn, which is exactly why the runner's stall guard counts
frames rather than vitals rows. `run_oxyii` now counts the RUN of such episodes
(`ring_barren_connects`), reset by any connect that delivered a frame and — deliberately — *not* by
one that failed before identity, which is the offline alarm's business and would otherwise let an
alternating failure hide forever. At three (`alerts.RING_BARREN_ALERT_N`) it journals, publishes
`ring_barren_alert`, draws a `ring-barren-alarm` block, and sends one webhook per episode with its own
latch and its own recovery message — the device is *connected* the whole time it fires, so nothing
else on the box would ever speak for it.

Each clause catches what the other cannot: an impostor that echoes the configured serial passes
clause 1 and, if it cannot produce Viatom frames, fails clause 2; a wrong-but-real O2Ring streams
perfectly and fails only clause 1.

⚠ Clause 2's journal guard is a transition into the ALERTING STATE, not into a new string — its text
carries the run length, so the text-comparison that is correct for clause 1 journalled at 3 and again
at 4. Measured by the test, not reasoned about.

⚠ The run is DRAWN, not merely forwarded. It was first published to `/api/state` and rendered by
nothing — `find_unwired` reds that as the half-wired shape (O2RING §20), and it is right to: a number
no surface shows is not restraint. The noise argument that motivated hiding it is answered by drawing
it only while it is non-zero.

Tests: 28 across `test_alerts`, `test_capture_runners`, `test_webmon_state_contract` and the new
`test_monitor_ring_identity` (render executed under node, hostile strings entity-encoded). Nine
plants — journal every readback, latch before delivery, never clear the latch, never compare; drop
the reset arm, count failed connects, journal every episode, shift the threshold, stop publishing
the count — each turn named tests red.
