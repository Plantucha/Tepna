<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: none
---
The O2Ring .bin decoder no longer fabricates today's date for an undated recording — with no 14-digit filename stamp and no file.lastModified it emits a time-only HH:MM:SS clock (date unknown) instead of stamping the whole night at Date.now() (Clock Contract §4).
