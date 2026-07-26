<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md
---
Rename the BLE autosuspend udev rule 50- to 99- so it wins against Ubuntu's own 60-autosuspend.rules — as shipped, the documented root-cause fix for the dongle firmware-wedge was silently overridden on every boot and never actually took effect.
