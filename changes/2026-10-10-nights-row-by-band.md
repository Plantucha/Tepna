---
bump: minor
type: fix
brief: briefs/NIGHT-IS-THE-RECORDING-2026-10-05-BRIEF.md
---

The Nights page groups a row by the NIGHT BAND the recording begins in, not by the calendar folder its
bytes landed in, so one night whose Polar streams start after midnight is ONE row carrying every device.
Row identity is `(night band, recording start)`: one band can carry two rows when a doff gap splits it,
and a session whose band-date folder was never created is adopted into that band's row.
