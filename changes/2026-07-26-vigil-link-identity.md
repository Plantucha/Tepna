<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The signal trace showed one hour of an eleven-hour night, and the pulse-rate and motion cards showed no capture line at all. The LINK sidecar gained an address column mid-corpus, so one night is half name-keyed and half address-keyed; `link.get(addr) or link.get(name)` took whichever answered first and discarded the rest (1238 of 1396 samples). Samples are now merged across a device's address, current name and any `name_aliases`, and rows that carry both columns teach the reader to fold earlier name-only rows onto the right device. `pr` and `motion` are columns of the SpO2 sidecar rather than streams of their own, so they now resolve to the file that carries them instead of rendering blank. Also fixes the newest RSSI sample being dropped for sitting exactly on the window's right edge.
