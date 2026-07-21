<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-ADAPTER-FALSE-WEDGE-2026-07-20-BRIEF.md
---
Stop the adapter watchdog power-cycling the whole radio when one churny device throws InProgress while others stream — a single device's InProgress is an adapter wedge only when no device is connected.
