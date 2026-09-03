<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
capture-host: a night the O2Ring is not worn no longer logs a traceback and a false "the arrival writer did not close cleanly — its tail may be unflushed" once per reconnect — `oxy_arr_wr` was the one writer missing from the pre-`try` None binding, so the teardown read an unbound local and warned about a tail that was never opened; a genuine close failure still warns.
