<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
capture-host: `find_unwired.py` no longer counts a COMMENT as a consumer — the unwired-field gate read its consumer corpus as raw text, so a status key named in prose registered as a key that reached somebody, and the prose doing it was a `monitor.html` comment recording that `STATUS["autopull"]` reaches nobody. Two real orphans were masked this way and are now visible.
