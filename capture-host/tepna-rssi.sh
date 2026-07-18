#!/usr/bin/env bash
# tepna-capture — tepna-rssi.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# NOPASSWD-sudo helper: read the CONNECTION RSSI of an already-connected BLE device. Reading a live ACL
# link's RSSI needs CAP_NET_ADMIN, which is why this exists as a tiny fixed-surface helper rather than a
# blanket `sudo hcitool` grant.
#
# WHY NOT `hcitool rssi <bdaddr>`: that path resolves the peer via the HCIGETCONNINFO ioctl using
# ACL_LINK, i.e. BR/EDR only. Against a Bluetooth LOW ENERGY connection it fails with
# "Get connection info failed: No such file or directory" (ENOENT) even though the link is up and
# healthy — verified on real H10/Verity/O2Ring links 2026-07-18. Instead we look the peer's CONNECTION
# HANDLE up from `hcitool con` and issue the raw HCI **Read_RSSI** command (OGF 0x05 Status Parameters,
# OCF 0x0005), which is addressed by handle and is therefore link-type agnostic — it works for LE.
#
# The Command Complete event payload is: num_cmd(1) opcode(2) status(1) handle(2) rssi(1)
# → the RSSI is the LAST byte, a signed int8 in dBm.
#
#   DEPLOY ROOT-OWNED (never grant sudo on the in-repo copy — it sits on a user-writable mount):
#     sudo install -D -o root -g root -m0755 <repo>/capture-host/tepna-rssi.sh \
#          /usr/local/lib/tepna/tepna-rssi.sh
#   sudoers:  michal ALL=(root) NOPASSWD: /usr/local/lib/tepna/tepna-rssi.sh
#   usage:    tepna-rssi.sh <hciN> <AA:BB:CC:DD:EE:FF>   → prints `RSSI return value: <dBm>`
set -euo pipefail
hci="${1:?usage: tepna-rssi.sh <hciN> <dev-mac>}"
mac="${2:?usage: tepna-rssi.sh <hciN> <dev-mac>}"
# validate args — never pass unchecked strings to a privileged command
[[ "$hci" =~ ^hci[0-9]+$ ]]        || { echo "bad adapter: $hci" >&2; exit 2; }
[[ "$mac" =~ ^[0-9A-Fa-f:]{17}$ ]] || { echo "bad mac: $mac" >&2; exit 2; }

# 1) connection handle for this peer on this adapter (LE or BR/EDR alike)
handle=$(hcitool -i "$hci" con 2>/dev/null \
  | awk -v m="$mac" 'BEGIN{IGNORECASE=1} index(toupper($0), toupper(m)) {
      for (i = 1; i <= NF; i++) if ($i == "handle") { print $(i+1); exit } }')
[[ -n "${handle:-}" ]] || { echo "no active connection for $mac on $hci" >&2; exit 3; }
[[ "$handle" =~ ^[0-9]+$ ]] || { echo "unparsable handle: $handle" >&2; exit 3; }

# 2) HCI Read_RSSI by handle (little-endian u16)
lo=$(printf '0x%02X' $(( handle & 0xFF )))
hi=$(printf '0x%02X' $(( (handle >> 8) & 0xFF )))
out=$(hcitool -i "$hci" cmd 0x05 0x0005 "$lo" "$hi" 2>/dev/null) || { echo "HCI Read_RSSI failed" >&2; exit 4; }

# 3) last byte of the Command Complete payload = signed int8 dBm
byte=$(printf '%s\n' "$out" | grep -vE '^\s*$' | tail -1 | awk '{print $NF}')
[[ "$byte" =~ ^[0-9A-Fa-f]{2}$ ]] || { echo "unparsable HCI reply: ${byte:-<empty>}" >&2; exit 5; }
v=$(( 16#$byte )); (( v > 127 )) && v=$(( v - 256 ))
echo "RSSI return value: $v"
