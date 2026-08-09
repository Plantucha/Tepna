<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md
---

A mid-transfer timeout wrote the short buffer straight to `<session>.dat` — reproduced: a timeout at
offset 512 of 3002 left a 512-byte file at the final path, indistinguishable to anything globbing
`*.dat`. It now lands under `.part` and is renamed with `os.replace` only when the byte count matches
what the device declared. The prior design's intent is kept — the data is real, so it is still written
and still reported — but truncation is legible from the FILENAME rather than only from a sidecar field
every consumer must remember to read.
