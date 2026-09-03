<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: O2RING-PROTOCOL-2026-07-17-BRIEF.md
---
#2124 claimed the live reply's `[20:24]` sample offset was "not yet read by `oxyii.parse_ppg`". It has
been read since 2026-08-05 by `oxyii.ppg_stream_offset`, called from `capture.py` and pinned four ways in
`test_oxyii.py`. Corrected in place, with how the wrong claim was produced. Adds the per-opcode
implementation table, which exposes R21: five of the thirteen opcodes we send are ack-only and have no
reply parser, so a rejected `SET_CONFIG` or `SET_UTC_TIME` is indistinguishable from an accepted one.
