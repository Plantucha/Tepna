#!/usr/bin/env bash
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
# Unwedge the O2Ring BLE link, capture one dual-wavelength sample, ALWAYS restore recording.
# The wedge signature: `bluetoothctl info` says Connected: yes while discovery cannot see the ring.
# A connected peripheral stops advertising, so bleak's discovery-based connect fails "not found".
set -u
RING=D1:98:62:7C:92:B3

restore() { echo "[restore] restarting tepna-capture"; sudo systemctl start tepna-capture; }
trap restore EXIT INT TERM          # recording comes back even on ^C or a probe crash

echo "[1/5] stopping capture service (it holds the link)"
sudo systemctl stop tepna-capture
sleep 2

echo "[2/5] dropping any stale BlueZ link"
bluetoothctl disconnect "$RING" >/dev/null 2>&1
bluetoothctl remove "$RING"     >/dev/null 2>&1   # clears a cached, non-advertising entry
sleep 1

echo "[3/5] cycling both adapters"
for a in hci0 hci1; do sudo hciconfig "$a" down; done
sleep 2
for a in hci0 hci1; do sudo hciconfig "$a" up; done
sleep 3

echo "[4/5] scanning for the ring"
/opt/tepna/capture-host/.venv/bin/python /tmp/scan.py

echo "[5/5] probing dual-wavelength (cmd 0x05) + vitals (cmd 0x04)"
timeout 120 /opt/tepna/capture-host/.venv/bin/python /tmp/rprobe.py
echo "[done] result: /tmp/rprobe.json"
