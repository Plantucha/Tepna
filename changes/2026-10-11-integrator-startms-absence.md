---
bump: patch
type: fixed
brief: none
---

Remove the last `startMs || 0` fabrication in the Integrator — the one site a completed sweep's verification grep could not see because it searched for the shape it had just eliminated — and anchor that sweep's gate on the fabrication rather than on the syntax surrounding the instances already fixed.
