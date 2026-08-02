<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md
---
Add the Phase-0 recon probe for Polar onboard recording, and the brief it answers.

The live BLE link is the single point of failure for every Polar signal and a dropout is currently
unrecoverable — on 2026-07-17/18, armband motion plus link loss put ECG-vs-arm-PPG rMSSD 70-76% apart on
nights with no second copy. `probe_polar_onboard.py` measures what the H10 and Verity actually hold
before a recording lifecycle is designed around a guess: firmware against the 2.1.0 offline-recording
floor, every session already on flash with byte sizes, and the device-vs-host clock offset. It is
deliberately READ-ONLY and does not start a recording: the wire format of the start op is unestablished
and `polar_psftp` refuses `REQUEST_START_RECORDING (14)` by allowlist, beside `PREPARE_FIRMWARE_UPDATE`.
Three answers are tri-state by construction and tested as such — unreadable firmware grades the
capability UNKNOWN rather than unsupported, an unread device clock is null rather than 0.0 (which would
read as perfectly in sync), and a `/U/` file outside a session directory counts its bytes without
inflating the session count that blocks the H10's single slot.
