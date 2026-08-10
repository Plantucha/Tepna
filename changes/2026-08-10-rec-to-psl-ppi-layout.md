<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
Convert a `.REC` PPI recording to the real PSL PPI layout — interval first, hr last, no device-clock
column — instead of refusing it. Gated by byte-identity with the live writer, which is the code that
produced all 107 `*_PPI.txt` in the vendor corpus.
