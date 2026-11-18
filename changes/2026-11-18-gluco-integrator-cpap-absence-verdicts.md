---
bump: patch
type: fixed
brief: none
nodes: [glucodex, integrator, cpapdex]
---

Three absences no longer publish as verdicts (audit and patches by Shrike, reviewed and landed by Kestrel):

- GlucoDex: a record with no 03–06h to 06–08h window publishes `dawnPhenomenon.present: null` with a reason. Before, it published `false`, the value of a measured negative.
- Integrator: a CGM cell whose export declares no flag keeps `f: null`. Before, the adapter stamped it `0` (OK), so the artifact exclusion counted it as measured glucose. `glucoseMetricsInWindow` now publishes `nFlagUnknown`.
- CPAPDex co-import: a borrowed oximetry night that shares less than 10 % of the CPAP night gives no AHI to ODI verdict, and the note states the overlap.
