<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: POLAR-VERITY-DEVICE-SURFACE-2026-08-03-BRIEF.md
---
The whole Verity Sense surface, written up the way `O2RING-PROTOCOL` writes up the ring.

A day of probing produced findings scattered across changesets, code comments and three other briefs.
This consolidates them into one hardware reference in the established shape: identity · GATT map ·
the complete PMD instruction set · settings menus and SDK mode · offline recording · the device
filesystem · the `.REC` container · timebase · security · operational quirks · open questions.

It matters that there is nothing to check it against: polar-ble-sdk issue #556 is open and unanswered
and the main community library is streaming-only, so the document carries its own evidence throughout.

Two findings in it are not merely protocol notes. **The bonding table is world-readable to anything that
reaches PS-FTP** — one directory per paired host, each with that peer's address and a 128-bit key — and
`USERID.BPB` carries the owner's real name. And **the timebase is UTC while the Clock Contract stores
floating local**, with `polar_psftp` labelling that field `start_local`.

§12 records five method errors, each of which produced a confident wrong answer with no error message —
including one conclusion published earlier the same day ("USB reads what BLE refuses") that was simply
the trust bit being unset.

Docs-only — no bundle, no `manifestHash` movement, no fixture re-recorded.
