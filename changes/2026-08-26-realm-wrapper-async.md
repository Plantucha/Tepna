---
bump: patch
type: fixed
brief: none
---

Harden both realm execution wrappers against async results. resultString and runBattery caught only
the synchronous throw, so an async function's rejection escaped later as an unhandled rejection and
killed the driver — measured twice on 2026-08-26 (ppgdex stuck at 350/406, and the crawl crashing
after checkpoint). A promise result is now its own classified state, never a rendered {}.
