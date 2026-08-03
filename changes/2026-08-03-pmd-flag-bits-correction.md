<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md
---
The PMD bitmask's three extra bits are MODES, and this repo already knew that.

`POLAR-PMD-COMMAND-SURFACE` §4 called `0x09`/`0x0D`/`0x0E` "undocumented measurement types" and left
open what `0x0E` carries, floating skin temperature as a guess. All three are capability flags —
**`0x09` SDK_MODE · `0x0D` OFFLINE_RECORDING · `0x0E` OFFLINE_HR** — named in `webmon.py:606` and
gate-locked by `test_capability_flags_are_not_offered_as_streams` since before the sweep ran.

The measurements were right; the framing was not. The failure is worth naming because it is cheap to
repeat: **hardware was measured before the tree was searched**, so settled, gate-backed knowledge got
converted back into an open question — and published as one. There is no temperature stream.

The `ok`-versus-`invalid_meas` split survives as a genuinely useful tell: `OFFLINE_HR` names a real
recordable data type, so a settings read about it answers `ok` with an empty menu, while the two pure
modes are rejected outright. That is how you separate a flag from a stream on a bitmask that mixes both.

`probe_pmd_surface.py` gains `FLAG_NAME` and reports `flag_bits` instead of
`undocumented_measurement_types`; `--include-undocumented-types` becomes `--include-flag-bits`. The
table is deliberately **NOT** in `pmd.MEAS_NAME`: webmon decides what is capturable with
`not str(x).startswith("0x")`, so naming them there would offer three modes to the user as streams —
now asserted, so the tempting "fix" fails loudly.

capture-host only, out of suite — no bundle, no `manifestHash` movement, no fixture re-recorded.
