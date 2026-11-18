<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ppgdex]
brief: none
---
PpgDex no longer grades an absent metric as the worst band. A record with no detected beats shows `Mean SQI` as a dash. The session switcher no longer prints "null". One unmeasured epoch no longer stops the page half-way through its render.
