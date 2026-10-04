---
bump: patch
type: fixed
brief: PAT-HAT-RING-FLOOR-2026-10-04-BRIEF.md
nodes: [analysis, capture-host]
---

The O2Ring's stream-position field is device-dead, and the consumer now says so by name.

`oxyii.ppg_stream_offset` reads 0x04's `[20:24]` — the field E11 writes into `first_sample_idx` and the
corrected PAT hat anchors on. Measured 2026-10-04: it is ZERO on every frame this ring has ever sent (819
OXYFRAME files, plus the committed real frame reading `00000000` at `duration = 10,719 s`). So the finger
leg is structurally absent on this ring, not merely absent on nights recorded before #3267.

No wrong floor was ever produced — both halves already refused — but both reasons described a CORRUPT
CAPTURE, which sends a reader hunting a bad file instead of telling them the device cannot do this.
`ring-offset-never-advances` now names it, keyed on NON-ADVANCE and never on the value 0, because 0 is a
legitimate first-frame position.

∅ The capture still records the device's 0 rather than null: 0 is what the ring SAID, blank in that column
means nothing was received, and nulling it would delete the evidence that produced this finding.
