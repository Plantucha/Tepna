<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
Leave the four Polar device-telemetry columns EMPTY in PpgDex's self-PPI interop export instead of writing a literal `0;0;1;1` — read back through `parseDevicePPI` that asserted zero uncertainty, nothing blocked and skin contact confirmed, beat by beat, about quantities an optically-derived PPI never measured.
