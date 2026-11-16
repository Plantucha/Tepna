---
bump: patch
type: fixed
brief: none
---

Count a refused body-position label as unmeasured in the Integrator positional-apnea pass, not as a measured non-supine posture.

Both posture nodes write the label `unknown` for an epoch they read and would not name. The old test sent every one of those to the non-supine count. Nine refused epochs then read as nine measured non-supine postures. That gave a supine rate of 0 over an empty population. It also gave a note that said the events do not cluster supine.

The verdict `positional` is now null with a reason when no confirmed event carries a measured position. The result reports the three absences apart, and the KPI tone and the card colour hold a null arm.
