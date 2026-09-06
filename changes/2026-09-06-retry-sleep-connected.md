---
bump: patch
type: fixed
brief: briefs/CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05-BRIEF.md
---

capture-host: a runner waiting to retry no longer publishes `connected: true`.

`_retry_sleep` now stamps `connected=False` as part of publishing the wait, so STATUS cannot carry a
live link and a `retry` block at the same time. Only the `backoff` path read False before, and only
incidentally — its `except` handler happened to stamp it; `charging`, `stalled` and `not_worn`
advertised a connected device for the whole wait.

The stamp is in `_retry_sleep` rather than at the stall branches because all eight production call
sites are structurally outside their `try:`/`async with _connect(...)` — verified on the tree, not
assumed — so the invariant belongs to the function, not to three branches.

Behaviour note for readers of the LINK sidecar: rows written during a stall/charging/not-worn wait
now record `connected=0` rather than `1`. That is the honest value (the link is down for the whole
wait) and it is what `link_distress` and `timeline` already assume the column means.

Costs no link generation: `_LINK_EPOCH` counts False→True edges, and the next loop iteration already
stamps False unconditionally before every connect attempt. Measured both ways — epoch identical.
