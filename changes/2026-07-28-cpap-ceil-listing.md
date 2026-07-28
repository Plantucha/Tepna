<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Stop rejecting half of every CPAP download as truncated — the card's listing ceils, and completeness is now judged against the exact Content-Length.
