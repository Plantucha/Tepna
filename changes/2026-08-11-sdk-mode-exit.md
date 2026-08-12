<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Turning the SDK-mode switch off now actually leaves SDK mode (`03 09`) instead of merely not
re-entering it — on a Verity Sense, staying in it disables PPI and HR entirely.
