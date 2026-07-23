<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
Anchor the PpgDex app companion-pairing filename-stamp regex so an all-digit device serial can no longer be misread as the date — the lone unanchored sibling made every ACC/GYRO/MAGN/PPI companion of an all-digit-serial Verity/PSL or capture-host recording exceed the 24 h pick gap and silently drop.
