<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
---

`oxyii.parse_live` decodes the O2Ring's live frame, and nothing held its byte offsets or its validity
bands: 13 of its mutants survived, including `batt_state` reading payload[13] instead of [12] and
`run_status` reading [5] instead of [4]. That class already shipped here once — the function's own
docstring records [7] and [11] being swapped, sending perfusion index into the SpO2 CSV's Motion column
and breaking OxyDex's artifact filter for months. Four tests pin every field to its own byte, the
`< 14` frame guard on both sides, and both bands at their exact edges. 13 -> 0, confirmed by ID.
