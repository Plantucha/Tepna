---
bump: patch
type: fixed
brief: none
---

Execute motiondex-render.js in the test harness, and assert the values it surfaces.
A throw at the top of renderSummary left every render group and the full lane green, because
no lane ran the file. The render legs read its source text instead.
