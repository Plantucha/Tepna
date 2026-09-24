<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
`LOSS-AUDIT.json` publishes each device's gaps one by one: `gaps: [{at, s, cause}]`, with the local start
to the second, the length and the same cause string `by_cause` keys on. `by_cause` is now summed from that
list, so the two cannot disagree. A consumer that judges the WORN interval (the solid-night continuity
band) can count only the gaps inside it, which a per-cause total over the whole file cannot answer. The
list covers the audited primary file only, the same file `by_cause` already covered.
