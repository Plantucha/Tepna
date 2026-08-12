<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md
---
The optical worn calibration now declares the PPG rate it was measured at and REFUSES outside it —
at 176 Hz it was reporting `worn: False` for an armband showing a 57 bpm pulse.
