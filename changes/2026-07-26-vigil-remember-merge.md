<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Merge onto an existing device in /api/remember instead of replacing it — a re-scan was silently erasing configured per-stream rates and overwriting the established device_id, which renames every future capture file.
