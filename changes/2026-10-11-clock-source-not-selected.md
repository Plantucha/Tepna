<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host, docs]
brief: none
---
The Clock & NTP card called every network server "unreachable" while the box's own PPS was preferred.
chrony's `?` covers both "nothing answered" and "polled, not selected"; `host_clock.parse_chrony_sources`
now resolves it by the reach register (0 → `unreachable`, otherwise `not selected`), the card has a glyph
for the new state, and the doc says the all-`not selected` picture is the normal one.
