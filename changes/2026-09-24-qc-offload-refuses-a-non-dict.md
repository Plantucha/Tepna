<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`qc_poller` refuses a scan result that is not a dict, naming the type and the value, and its swallowing
handler now logs `exc_info` — so the `'str' object has no attribute 'get'` that reddened #3024, #3027
and 320d7a6e on main under `-n 4` names its frame the next time it happens. Both consumers of
`STATUS["devices"]` also refuse a per-device entry that is not a dict, which is where that error was
actually raised.
