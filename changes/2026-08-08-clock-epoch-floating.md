<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---
A full sweep found `clock.js:30`'s `* 60000` mutated to `* 0` — making `tzOffset()` always return zero — **survives all 699 assertions.** Nothing in the suite noticed that a numeric epoch would then be stored as the raw UTC instant instead of the recording's local civil time: a **four-hour** error on an EDT machine, in the single conversion Clock Contract §2.1 exists to specify.

It survived for a reason worth recording. **On a machine running UTC the mutant is genuinely equivalent** — `tzOffset()` is zero either way — so a test written casually on a UTC CI box cannot fail, and would reasonably have been deleted as pointless. That is why this group **forces** a zone rather than trusting the ambient one. `Asia/Kolkata` is deliberate: +05:30 is non-zero *and* not a whole hour, so it also catches an implementation that rounds to hours.

Five assertions: epoch → local civil time encoded as UTC · that this is **not** the raw instant · `offsetMin` is minutes east of UTC · an all-digit *string* epoch resolves identically (§2.1 covers both) · and a no-zone local stamp for the same wall time agrees, which is the cross-device property the conversion exists to provide.

Verified by re-applying the mutant: **4 of 5 assertions red**, `offsetMin` reporting 0 against 330. Node applies a `process.env.TZ` change to Dates created afterwards — checked directly, not assumed — and the zone is restored in a `finally`, because leaking one into the rest of the suite would be its own bug. Node-only by construction; the browser lane skips, and a runtime where the forced zone does not take (an ICU-less build) skips rather than asserting something vacuous.

Tests only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
