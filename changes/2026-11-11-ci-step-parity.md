---
bump: minor
type: added
brief: none
---

Pin the gap between the local gate's step list and the workflows that run it. `tools/ci-step-parity.mjs` reads every step of `npm run check` against the 12 workflow files. A step counts as covered when a workflow holds its own command, or the `npm run` alias. 40 of the 64 steps run in no workflow, and the gate pins that number two-sided. So a step that lands with no workflow line reds, and a step that gains one reds until the pin drops. Closing the gap adds blocking work, which stays the owner's call.
