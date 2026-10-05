---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

Five absences on the capture box stop reading as observations: a live frame pushed before its rate is negotiated no longer carries the vendor default, an undatable CPAP reading reads unknown, a faulted ring probe is wear unknown rather than no finger, an O2Ring USB reply that does not decrypt is withheld instead of being written into the pulled file, and a one-channel CPAP batch no longer shifts flow against pressure in the EDF. Open ABSENCE-SURVEY findings: 270 of 290.
