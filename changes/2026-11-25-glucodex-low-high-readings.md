---
bump: patch
type: fixed
brief: none
---

GlucoDex reads a CGM `Low` or `High` cell as a reading outside the sensor range. Each one counts as sensor-active time and as time below 54 or above 250 mg/dL, opens or extends a nocturnal-hypo event, and carries no value. A file that opens on many such cells is read, where the column pick refused it. The exports gain `outOfRange` and `rowsDropped`, and the Integrator's glucose window counts the same cells as time out of range.

A record with no measurable cadence withholds its nocturnal hypos and excursions as null, with the reason. The app counted 0 there, and its page now renders the record. The hypo and QTc read no longer says `clear` over such a record.
