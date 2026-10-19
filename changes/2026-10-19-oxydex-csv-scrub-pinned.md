---
bump: patch
type: fixed
brief: none
---

A test now pins the OxyDex CSV scrub. That scrub keeps the text `null`, `undefined` and `NaN` out of 75 numeric fields. The test lifts the scrub from `oxydex-app.js` and runs it on a sample CSV. A deleted scrub now fails 3 assertions.
