---
bump: patch
type: fixed
brief: none
---
The served site now carries a `404.html`. Without it, the host answered every unknown path with the homepage and status 200. The page says that MotionDex and the research tools run from the source repository. `tools/build-docs.mjs` keeps the page out of the sitemap.
