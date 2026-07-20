<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-RECONNECT-BACKOFF-AND-LINK-COUNT-2026-07-20-BRIEF.md
---
Make the O2Ring reconnect backoff reset on data (not bare connect) so a flapping ring stops hammering, and count reconnect edges in LINK.csv so the 25 s poll can't miss a dropout.
