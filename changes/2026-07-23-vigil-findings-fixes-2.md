<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
Execute the pytest-gated Vigil findings batch 2 (out-of-suite capture-host/): make the byte-stall
watchdog PER-STREAM (`any_stream_stalled`) so a dead stream behind a live sibling — the ECG-flowing-
while-ACC-at-zero class the old shared timer masked — is finally caught; resolve the BLE adapter MAC→hciN
over sysfs (`/sys/class/bluetooth/hciN/address`) FIRST, dependency-free, so the Pi 5 target (no hcitool)
no longer silently falls back to the deaf onboard radio, with hcitool kept only as a fallback; gate
`is_bonded` on `Bonded: yes` specifically (a transient LE `Paired`-without-`Bonded` lacks the long-term
keys, so it now re-pairs instead of leaving the strap dropping discovery); and classify an adapter
connection-ceiling error distinctly (`connection_ceiling_error`) so an over-provisioned dongle is
diagnosable rather than reading as a flapping sensor. 10 new/updated capture-host pytest cases; 921 passing.
