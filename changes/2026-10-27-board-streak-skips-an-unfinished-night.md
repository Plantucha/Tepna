---
bump: patch
type: fixed
brief: none
---

The fleet board's solid-night streak now skips a night whose verdict predates the end of its own band. Such a night neither extends nor resets the streak, and the card names it as pending. The reader of the band is the verdict's own `result.scope.band`, so no rule keys on the folder date any more. A verdict stamped after its band ended still counts. A PASS carrying no band, or none of its own verdict time, stops the streak with a named reason.
