<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---
Adds §3.6 — a trap found while trying to verify `PAT-PERBLOCK-ALIGNMENT`'s correction of §3.2, and distinct from what that correction identifies.

The obvious way to get pulse arrival time from the drift work is to apply the per-block offset and then find the first pulse foot after each R-peak. Done that way, 2026-07-27 gives **beat-to-beat IQR 12 ms, median lag 73 ms** — comfortably inside `pat-gate.js`'s ≤60 ms bar.

It is meaningless. All **199 lags in one block fall in a single 50 ms bin**, hard against the search window's 60 ms lower edge. The block offset was fitted by *maximising beat coincidence*, i.e. it aligned R-peaks onto pulse feet and absorbed the transit into the offset. What remains is the residue after the fit already removed the thing being measured.

**An alignment used to measure a physiological delay must not have been fitted on the two channels whose delay is being measured.** It has to come from a channel with no physiological path — the ACC envelope — or a host reference.

So §3.2 was wrong for the reason `PAT-PERBLOCK-ALIGNMENT` gives (a fit residual and a beat-to-beat interval are different quantities sharing units) **and** cannot be rescued by measuring the right quantity through this alignment. Both routes close.

Also adds a third item to §4's method lesson: **check where your answer sits inside its own search window** — a result piled against a window edge is the window, not the signal, and it is visible in one histogram before any statistic is computed.
