<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
capture-host DEEP-AUDIT-VI F18 + F17: the night-QC stream watchdog now admits the auto-start attempt record only when its session key matches a Therapy-run onset the journal observed inside the night window (a marker from a failed night days earlier no longer relabels tonight's NEVER_STARTED as AUTOSTART_FAILED); and `cpap.ble_stream.creds_path` resolves against the config directory while `edf_dir` / `raw_record_dir` resolve against the box root — never the daemon's cwd — with the resolved absolutes logged once at wiring.
