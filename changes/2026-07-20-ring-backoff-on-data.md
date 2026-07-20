<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Re-arm the O2Ring reconnect backoff only once the link has carried data, so a connect that fails at service discovery can no longer pin the retry loop to its floor.
