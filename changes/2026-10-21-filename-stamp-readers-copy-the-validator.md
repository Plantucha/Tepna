---
bump: patch
type: fixed
brief: none
---

Seven filename and night-key readers now range-check a stamp before building an instant, so an
impossible stamp refuses instead of rolling onto a real date. Their bundles carry no `clock.js`,
so each takes the validator its own bundle already inlines, and the suite pins the copies against
each other and against `clock.js`.
