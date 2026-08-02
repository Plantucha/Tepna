#!/usr/bin/env bash
# tepna-capture — tepna-usbreset.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# NOPASSWD-sudo helper: RE-ENUMERATE a docked Polar sensor by toggling its USB `authorized` flag.
#
# WHY THIS EXISTS. PS-FTP rides the Polar dock's USB HID pipe and serves the device filesystem — but
# only inside a window that opens on USB **re-enumeration** (proven by replug, 2026-08-02: the first
# GET after a replug returned a real directory listing, the next one a second later was back to 1-byte
# filler). Toggling `authorized` re-enumerates in software, so a pull does not need a human to unplug
# the sensor. Writing that sysfs attribute needs root; the daemon runs as an unprivileged user. Hence a
# tiny fixed-surface helper, exactly like `tepna-rssi.sh`, rather than a blanket sysfs grant.
#
# ⚠️ THE VID:PID ALLOWLIST IS THE SECURITY SURFACE — do not widen it to "whatever the caller passes".
# `authorized` is a loaded gun: deauthorizing the wrong device detaches the boot disk, or the very BLE
# adapters the capture depends on (the box has three, and one is already known to go deaf). A helper
# that resets an arbitrary VID:PID as root is a denial-of-service primitive. This one refuses anything
# that is not a known Polar dock, so the worst it can do is bounce a sensor that is already docked.
#
# On TEPNA_USB_SYSFS: it exists so the tests can drive a fake tree, and it is not an escalation path —
# sudo's `env_reset` (default) strips it, and even with it set the script only ever writes `0`/`1` to a
# file named `authorized` in a directory whose `idVendor`/`idProduct` already match the allowlist.
#
#   DEPLOY ROOT-OWNED (never grant sudo on the in-repo copy — it sits on a user-writable mount):
#     sudo install -D -o root -g root -m0755 <repo>/capture-host/tepna-usbreset.sh \
#          /usr/local/lib/tepna/tepna-usbreset.sh
#   sudoers:  vigil ALL=(root) NOPASSWD: /usr/local/lib/tepna/tepna-usbreset.sh
#   usage:    tepna-usbreset.sh 0da4:0008    → prints `re-enumerated: <port> devnum <old> -> <new>`
set -euo pipefail

ALLOWED="0da4:0008"                       # Polar Electro Oy dock (Verity Sense / H10 charging cradle)
SYSFS="${TEPNA_USB_SYSFS:-/sys/bus/usb/devices}"
SETTLE="${TEPNA_USB_SETTLE:-2}"           # seconds deauthorized; the device must notice the drop
TIMEOUT="${TEPNA_USB_TIMEOUT:-10}"        # seconds to wait for it to come back

id="${1:?usage: tepna-usbreset.sh <vid:pid>}"
# validate BEFORE use — never pass an unchecked string toward a privileged write
[[ "$id" =~ ^[0-9a-fA-F]{4}:[0-9a-fA-F]{4}$ ]] || { echo "bad vid:pid: $id" >&2; exit 2; }
id="${id,,}"
case " $ALLOWED " in
  *" $id "*) ;;
  *) echo "refusing $id — not in the allowlist ($ALLOWED)" >&2; exit 2 ;;
esac
vid="${id%%:*}"; pid="${id##*:}"

find_port() {
  local d v p
  for d in "$SYSFS"/*/; do
    [[ -r "$d/idVendor" && -r "$d/idProduct" ]] || continue
    v=$(cat "$d/idVendor" 2>/dev/null) || continue
    p=$(cat "$d/idProduct" 2>/dev/null) || continue
    if [[ "${v,,}" == "$vid" && "${p,,}" == "$pid" ]]; then
      basename "$d"
      return 0
    fi
  done
  return 1
}

port=$(find_port) || { echo "no device $id is docked" >&2; exit 3; }
dev="$SYSFS/$port"
[[ -w "$dev/authorized" ]] || { echo "cannot write $dev/authorized (run as root)" >&2; exit 4; }
before=$(cat "$dev/devnum" 2>/dev/null || echo "?")

echo 0 > "$dev/authorized"
sleep "$SETTLE"
echo 1 > "$dev/authorized"

# Wait for it to come back rather than returning into a race — the caller's whole reason for calling
# is to issue ONE request into a window that has just opened, and a premature return spends it on a
# device that is not enumerated yet.
deadline=$(( SECONDS + TIMEOUT ))
while (( SECONDS < deadline )); do
  if port=$(find_port) && [[ -r "$SYSFS/$port/devnum" ]]; then
    after=$(cat "$SYSFS/$port/devnum" 2>/dev/null || echo "?")
    echo "re-enumerated: $port devnum $before -> $after"
    exit 0
  fi
  sleep 0.2
done
echo "device $id did not re-enumerate within ${TIMEOUT}s" >&2
exit 5
