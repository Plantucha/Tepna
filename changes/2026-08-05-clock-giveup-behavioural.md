<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
---

`clock_watchdog` had no behavioural test — only source scans, which cannot see a changed dict key. Four
mutants lived there: the give-up verdict keyed by a constant (so it repeats every 5-minute cycle
forever), the once-only guard removed, the verdict filed under no device, and `gave_up.discard(addr)`
deleted — which restores the STICKY give-up this file's header records as a real 2026-07-29 failure.
The sticky one needed a device that gives up, RECOVERS and degrades again to distinguish: "published
exactly once" is equally satisfied by a verdict published once and then never again.
