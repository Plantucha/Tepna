---
bump: patch
type: fixed
brief: none
---

GlucoDex reads a CGM `Low` or `High` cell as a reading outside the sensor range. Each one counts as sensor-active time and as time below 54 or above 250 mg/dL, opens or extends a nocturnal-hypo event, and carries no value. The export gains `recording.outOfRange` and `recording.rowsDropped`.
