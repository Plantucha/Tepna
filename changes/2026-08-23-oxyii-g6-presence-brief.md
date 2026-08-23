---
bump: patch
type: added
brief: OXYII-PRESENCE-MODEL-2026-08-23-BRIEF.md
---

The G6 presence-model design brief (charter G6, spec §2–§6). Written against the measured hardware
briefs rather than assumptions, and verifying that evidence base changed the design before any code
was written.

§3's proposed post-recording probe is largely unnecessary: the still-recording discriminator is
already one byte in the live 0x04 frame — `contact == 0x03` is file-open (`oxyii.py:229`,
`O2RING-PROTOCOL` §62–63). The probe becomes the escalation, not the first move, which matters
because link acquisition costs p90 69 s to move a median 78 KB.

But contact reports what the SENSOR sees, not whether the DEVICE is present — with the ring off it
reads "no finger" while BLE stays up — so the state model needs both axes. Four open questions are
left explicitly unanswered rather than guessed, including whether contact is readable without a
connection, which decides whether the probe is escalation or first move.

Brief only; no code.
