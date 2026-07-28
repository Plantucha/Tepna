<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Create the harvest's wpa control directory without root — the sudo mkdir it replaced had silently stopped the CPAP harvest associating at all.
