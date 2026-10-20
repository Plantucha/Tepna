---
bump: patch
type: fixed
brief: RESIDUE.md
---

- Two pages now group a dropped folder into nights on each file's FIRST DATA ROW. The 14-digit stamp in its name no longer decides. The capture-host writes that name when it OPENS the session, before the connect. A stream that starts hours later still carries the earlier name.
- The two are `sensor-trio-power-analysis.js` and `sigma-no-reference-analysis.js`. PR #3746 made the same repair in `sensor-trio-night.js`, whose code both carried verbatim.
- A file whose rows carry no stamp keeps the filename key, and the ingest note states how many did. An invisible fallback is the defect this replaces.
- Each candidate records `stampSource`, so a consumer can tell a row-keyed night from a name-keyed one.
- The reader range-checks every component before `Date.UTC`, which the replaced `stampMs` did not. Clock Contract §2.7: a bad component rolls onto a wrong instant, and the one legal overflow is ISO `24:00:00`.
- The suite now slices the reader out of all THREE page sources and executes each copy. One table drives all three, so no copy can drift alone.
