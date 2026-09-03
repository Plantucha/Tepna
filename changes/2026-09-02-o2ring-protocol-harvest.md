<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: O2RING-PROTOCOL-2026-07-17-BRIEF.md
---
The O2Ring protocol brief gains the vendor opcode map (33 commands, 13 implemented), the AES-128 session
on branch `2D010001`, byte `[14]`'s four alarm states, the full stored-file trailer map, and the decoded
`SET_UTC_TIME` timezone byte. Three claims it carried were stale and are corrected: "no AES anywhere on
the live or file path" (firmware-conditional), the auth timestamp's shift form (refuted by a USB capture
on 2026-08-30, and the brief was contradicting its own code), and "nonzero status byte ⇒ suspect sample"
(it is motion × 2 plus two alarm bits). Borrowed claims were re-verified against our own corpus where
possible — 30 stored files for the trailer, 6 for the epoch. R18–R20 log the code defects it surfaced.
