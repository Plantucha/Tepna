<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Move StartLimitIntervalSec to [Unit] in the shipped systemd unit — it was silently ignored in [Service] (systemd v230+), so the no-give-up-restart intent never applied.
