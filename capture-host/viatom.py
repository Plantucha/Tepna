# tepna-capture — viatom.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Viatom / Wellue O2Ring real-time BLE protocol (SpO2 + pulse). NOT PMD — the O2Ring speaks its own
# vendor protocol. Constants + packet offsets from the reverse-engineered reference
# `ecostech/viatom-ble` (real-time notification packet). No checksum in the protocol (relies on BLE CRC).
#
# The device notifies ~1/s while worn. We emit the ViHealth CSV layout OxyDex already parses
# (writers.Spo2CsvWriter) — zero new parser downstream (§7 integration contract).
#
# ⚠️ UNVERIFIED against a real O2Ring here — validate offsets on hardware (some models pad the packet
#    differently; guard by length + physiologic range, which we do below).

from __future__ import annotations

VIATOM_SERVICE = "14839ac4-7d7e-415c-9a42-167340cf2339"
VIATOM_WRITE   = "8b00ace7-eb0b-49b0-bbe9-9aee0a26e1a3"   # host -> device (request/start)
VIATOM_NOTIFY  = "0734594a-a8e7-4b1a-a6b1-cd5243059a57"   # device -> host (data); prefer discovery-by-property
START_CMD      = bytes([0xAA, 0x17, 0xE8, 0x00, 0x00, 0x00, 0x00, 0x1B])   # "request data" (ecostech/viatom-ble)

# Real-time packet byte offsets (ecostech/viatom-ble):
#   [7]=SpO2 %  [8]=pulse bpm  [14]=battery %  [16]=motion  [17]=perfusion*10  [18]=wear(0=off)
def decode_packet(data: bytes) -> dict | None:
    """Parse one real-time notification. Returns a dict (spo2/pr None when invalid/not-worn), or None
    if the packet is too short to be the real-time frame."""
    if data is None or len(data) < 19:
        return None
    spo2, pr = data[7], data[8]
    batt, motion, pi, worn = data[14], data[16], data[17], data[18]
    spo2_ok = 50 <= spo2 <= 100                # 0/255 = invalid; <50 implausible
    pr_ok   = 20 < pr < 255
    return {
        "spo2":  spo2 if spo2_ok else None,
        "pr":    pr if pr_ok else None,
        "batt":  batt,
        "motion": motion,
        "pi":    round(pi / 10.0, 1),
        "worn":  bool(worn),
    }
