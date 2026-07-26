<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Retry the PMD START of a charging Polar on the link already held instead of reconnecting for each attempt — a device on its dock reconnected every ~67 s indefinitely (17 connects in 19 minutes, writing nothing), and since every attempt logged as a successful `connected` only `link_epoch` ever revealed it. The wait is ticked so the link is released promptly when an offline pull needs it.
