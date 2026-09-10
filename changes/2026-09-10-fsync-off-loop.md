<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Move the writers' disk barrier off the event loop, so one stream's fsync no longer delays every other stream's host stamps.
