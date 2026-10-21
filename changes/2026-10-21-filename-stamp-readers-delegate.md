---
bump: patch
type: fixed
brief: none
---

Five filename and date readers now take the instant from `clock.js` instead of a bare `Date.UTC`,
so an out-of-range stamp refuses rather than rolling onto a real date.
