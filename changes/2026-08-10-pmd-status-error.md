<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`parse_status_response` read a control-point ERROR reply as measurement data — an H10's
`ERROR_INVALID_OP_CODE` became `{ppg: "none"}`, a state for a stream that device does not have.
