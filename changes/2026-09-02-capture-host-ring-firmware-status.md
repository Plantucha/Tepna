<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
capture-host: the O2Ring's Firmware Revision String is read once per connection into STATUS, and an unmeasured version is named at connect — newer firmware keys an AES session after an AUTH that is written fire-and-forget with no reply to inspect, so without this read the failure would arrive as "connects, auths, no decoded frames" and read as a bad link.
