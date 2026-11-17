---
bump: patch
type: fixed
brief: none
---

Refuse a CPAPDex number when its sample rate or record duration is absent.

Seven sites in `cpapdex-dsp.js` replaced an absent rate or duration with a guessed one.
A 0.5 Hz hour read as half an hour, and a 25 Hz lane with no header rate read 50 times too long.
An unreadable record duration became 60 s, and an open periodic-breathing span then scored 98.61 %.
Each of these sites now publishes `null` and names the absent fact.
A session with no record duration now has no `endMs` and no `durMin`, and its night has no `therapyHours` total.
