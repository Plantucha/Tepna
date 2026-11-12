---
bump: patch
type: fixed
brief: none
---

Name the cross-recording baseline in the unit it counts, and report the true span beside it.

PulseDex printed "your N-day baseline" and PpgDex printed "your N-night baseline" over N FILES. One
night captured as an overnight recording plus a next-morning fragment therefore read as two days or
two nights of baseline. The engine itself declares the unit a recording, never a night.

Each count now keeps the unit it counted. The card reports the span beside it over the owner-ruled
noon fold, where a recording that starts before noon folds into the previous evening. A recording
with no stamp belongs to no day, and the card counts it apart.

Both fixes are in the app layer, which sits outside the compute closure. The PulseDex computeHash
holds at db85b0c17553 and the PpgDex computeHash holds at 54b7dfb4d2fd, each over 18 assets.
