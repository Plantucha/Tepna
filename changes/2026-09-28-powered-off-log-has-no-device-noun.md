---
bump: patch
type: fixed
brief: none
---

The capture box's offline-alert poller no longer calls every quiet device a "ring". After a completed
pull, a device that powers off is logged as `<name>: powered off — idle timer …`, without a device noun.
On 2026-09-28 the H10 was logged as `ring powered off` 45 s after its not-worn auto-pull. The ring's own
reconnect loop (`run_oxyii`) keeps "ring", which is correct there. The quiet state and the status text are
unchanged.
