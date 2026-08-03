<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md
---
A stream the device will not serve was reported as "the whole device is charging".

`pmd.is_transient()` covers **two** statuses — `0x0D in_charger` and `0x0C invalid_state` — and
`capture.py` treated any transient START refusal as charging. They are not the same kind of fact:
`in_charger` is a **device** state, true of every stream on the sensor; `invalid_state` is a
**measurement** state and says nothing about the device.

Measured on the live box 2026-08-02. The Verity answers `invalid_state` to **PPI permanently** (its PPI
is unusable — the config already says so in a comment). PPI is negotiated **last**, so its refusal
overwrote the four successful `charging=False` writes from acc/gyro/mag/ppg. Consequences, in order of
how much they cost:

1. `charging_hold = True` **ends the session**, so the daemon re-negotiated the whole device roughly
   every 60 s, all night. One night landed as **26 files** instead of one.
2. Each of those sessions tripped the on-charger auto-pull, which **pauses live capture** to walk the
   device's filesystem and find nothing.
3. The monitor read `charging — PMD streams unavailable until off the charger` while the device was
   streaming **151 521 rows** with a battery **falling 96 → 91 %**. A charging battery does not fall.

So the wrong flag was not cosmetic; it fragmented recordings and then explained the fragmentation with
a reason that was false. The retry-don't-drop behaviour was right for both statuses and is unchanged —
what is now conditional is the *claim about the device*, and holding the session.

`polar_pmd` gains `IN_CHARGER` / `INVALID_STATE` as named constants with the distinction written at the
definition, because the next caller to reach for `is_transient()` will face the same fork.

The regression test was **verified against the unfixed code first** — it fails there with
`a per-measurement refusal claimed the whole device was on the charger`. A test written from reading
the fix would have passed either way.

⚠️ **Deploy note:** the live box is currently mitigated by config (`ppi` removed from the Verity's
streams, `pull.on_charger: false`). After this lands, both can be reverted — `ppi` becomes harmless and
the auto-pull will only fire when the device is genuinely docked.

capture-host only, out of suite — no bundle, no `manifestHash` movement, no fixture re-recorded.
