---
bump: patch
type: fixed
brief: none
---
A night whose rMSSD was never recorded reported a **−100 % day-to-day change** — a total autonomic collapse, manufactured from an absent measurement. The table rendered "−100.0%" and the chart painted the bar RED.

**One line carried two guards and only one of them worked.** `prev._rmssd > 0` correctly excludes an absent PREVIOUS night, because `null > 0` is false. `!isNaN(r._rmssd)` does not exclude an absent CURRENT one, because `isNaN(null)` is `isNaN(0)` — false. So null passed, and `((null - prev) / prev) * 100` is exactly −100. The current row now uses the same `> 0` test as the previous one; the symmetry is the point, since an asymmetric pair of guards on one expression is what hid this.

⚠️ The day gap defaulted to **1** when either stamp was unparseable, so two undated rows were treated as CONSECUTIVE DAYS and given a day-to-day reactivity reading they had no basis for. An unknown gap is now null, and `null === 1` is false, so the column refuses.

Both consumers already read NaN as absent (`isNaN(v) ? '—'`), so nothing downstream needed changing — the guards existed and the producer defeated them.

The twin is behavioural with real controls: 50 → 60 across one day is +20 %, 50 → 40 is −20 %, and both absence cases refuse. Planting the old `!isNaN` guard back reds it with **"got −100"**.
