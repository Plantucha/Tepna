#!/usr/bin/env bash
# tepna-capture — tepna-rssi.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# NOPASSWD-sudo helper: read the CONNECTION RSSI of an already-connected BLE device. Reading a live ACL
# link's RSSI needs CAP_NET_ADMIN (HCI Read RSSI) — the same reason `hcitool rssi` asks for root. Kept as
# a tiny fixed-surface helper (not a blanket `sudo hcitool` grant) matching tepna-clock.sh.
#
#   sudoers:  tepna ALL=(root) NOPASSWD: /opt/tepna/capture-host/tepna-rssi.sh
#   usage:    tepna-rssi.sh <hciN> <AA:BB:CC:DD:EE:FF>   → prints `RSSI return value: <dBm>`
set -euo pipefail
hci="${1:?usage: tepna-rssi.sh <hciN> <dev-mac>}"
mac="${2:?usage: tepna-rssi.sh <hciN> <dev-mac>}"
# validate args (never pass unchecked strings to a privileged command)
[[ "$hci" =~ ^hci[0-9]+$ ]] || { echo "bad adapter: $hci" >&2; exit 2; }
[[ "$mac" =~ ^[0-9A-Fa-f:]{17}$ ]] || { echo "bad mac: $mac" >&2; exit 2; }
exec hcitool -i "$hci" rssi "$mac"
