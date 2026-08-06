#!/usr/bin/env bash
# tepna-capture — tepna-btreset.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# NOPASSWD-sudo helper: RE-BIND a USB Bluetooth adapter by driver unbind+bind.
#
# WHY THIS EXISTS. This is the LAST rung of the adapter-recovery ladder — the one VIGIL-DEEP-ANALYSIS
# §2D identifies as the only thing that clears an RTL8761B FIRMWARE hang, which a soft `hciconfig
# reset` / `power off,on` leaves "powered but deaf". capture.py used to do the unbind/bind write
# ITSELF, and it could never have worked: `/sys/bus/usb/drivers/usb/{unbind,bind}` is `--w-------`
# root:root, while the daemon runs as an unprivileged user. Measured on the live box 2026-08-05 —
# `CapEff: 0000000000001000` is CAP_NET_ADMIN alone, no CAP_DAC_OVERRIDE:
#
#   the write raised PermissionError -> caught -> logged at INFO as "skipped" -> ladder reported done.
#
# So the rung was not merely unprivileged, it was SILENT about it, on a box whose config had
# `watchdog.usb_path: 1-2` set and therefore issued no "rung disabled" warning either. Hence this
# helper, and hence capture.py now logs a FAILED rebind at WARNING. See VIGIL-OVERNIGHT-FINDINGS §P1.3.
#
# ⚠️ NOT tepna-usbreset.sh, AND NOT A WIDENING OF IT. That helper toggles `authorized` on a docked
# Polar sensor to re-open the PS-FTP window, and is hard-allowlisted to `0da4:0008` precisely so it can
# never touch a radio. This one is its mirror image — it may ONLY touch radios — and the two allowlists
# must stay disjoint. Do not merge them into one "reset any USB device" helper: that is a root-level
# denial-of-service primitive, and the whole point of the fixed-surface helper pattern is to not have
# one.
#
# ⚠️ THE DEVICE-CLASS ALLOWLIST IS THE SECURITY SURFACE. Unbinding the wrong device as root detaches
# the boot disk or the network. The allowlist is USB class `e0:01:01` (Wireless Controller / RF
# Controller / Bluetooth) — read from the device the caller named, never from the caller's argument.
# It is a CLASS check rather than a VID:PID list on purpose: the box has already been through one
# adapter swap (the nRF went away, the Intel renumbered), and a per-model list would have to be
# re-edited as root each time — a list that must be maintained to stay safe eventually is not. Every
# hub on this box reads class `09`, every disk `08`; only the two real radios read `e0`.
#
# On TEPNA_USB_SYSFS / TEPNA_USB_DRIVER: they exist so the tests can drive a fake tree, and they are
# not an escalation path — sudo's `env_reset` (default) strips both, and even with them set the script
# only ever writes a validated bus-port id to files named `unbind`/`bind` after confirming the named
# device reports itself as a Bluetooth radio.
#
#   DEPLOY ROOT-OWNED (never grant sudo on the in-repo copy — it sits on a user-writable mount):
#     sudo install -D -o root -g root -m0755 <repo>/capture-host/tepna-btreset.sh \
#          /usr/local/lib/tepna/tepna-btreset.sh
#   sudoers:  vigil ALL=(root) NOPASSWD: /usr/local/lib/tepna/tepna-btreset.sh
#   usage:    tepna-btreset.sh 1-2    → prints `re-bound: 1-2 (2357:0604)`
set -euo pipefail

SYSFS="${TEPNA_USB_SYSFS:-/sys/bus/usb/devices}"
DRIVER="${TEPNA_USB_DRIVER:-/sys/bus/usb/drivers/usb}"
SETTLE="${TEPNA_USB_SETTLE:-1.5}"         # seconds unbound, before re-binding
TIMEOUT="${TEPNA_USB_TIMEOUT:-10}"        # seconds to wait for the driver to take it back

port="${1:?usage: tepna-btreset.sh <usb-bus-port>   e.g. 1-2}"
# Validate BEFORE use — this string is written into a privileged sysfs file. A bus-port id is digits,
# dots and one hyphen; anything else (a path traversal, a second argument, a metacharacter) is refused
# here rather than defended against later.
[[ "$port" =~ ^[0-9]+-[0-9]+(\.[0-9]+)*$ ]] || { echo "bad usb bus-port: $port" >&2; exit 2; }

dev="$SYSFS/$port"
[[ -d "$dev" ]] || { echo "no usb device at port $port" >&2; exit 3; }

# ── the allowlist ────────────────────────────────────────────────────────────────────────────────────
# Read the class triple off the DEVICE. A device that does not publish one is refused: "I could not
# tell what this is" must never resolve to "proceed" (the fail-open shape this suite treats as a bug).
cls=""; sub=""; proto=""
[[ -r "$dev/bDeviceClass"    ]] && cls=$(cat "$dev/bDeviceClass" 2>/dev/null)
[[ -r "$dev/bDeviceSubClass" ]] && sub=$(cat "$dev/bDeviceSubClass" 2>/dev/null)
[[ -r "$dev/bDeviceProtocol" ]] && proto=$(cat "$dev/bDeviceProtocol" 2>/dev/null)
if [[ "${cls,,}" != "e0" || "${sub,,}" != "01" || "${proto,,}" != "01" ]]; then
  echo "refusing $port — class ${cls:-?}:${sub:-?}:${proto:-?} is not a Bluetooth radio (want e0:01:01)" >&2
  exit 2
fi
ident="$(cat "$dev/idVendor" 2>/dev/null || echo '?'):$(cat "$dev/idProduct" 2>/dev/null || echo '?')"

# ── the rebind ───────────────────────────────────────────────────────────────────────────────────────
[[ -w "$DRIVER/unbind" && -w "$DRIVER/bind" ]] || {
  echo "cannot write $DRIVER/{unbind,bind} (run as root)" >&2; exit 4; }

echo "$port" > "$DRIVER/unbind"
sleep "$SETTLE"
# The bind must be attempted even if it fails, and its failure must be REPORTED — leaving the adapter
# unbound is strictly worse than the wedge we are clearing, on a box that is by construction remote.
if ! echo "$port" > "$DRIVER/bind" 2>/dev/null; then
  echo "UNBOUND $port but the re-bind FAILED — the adapter is now detached" >&2
  exit 6
fi

# Wait for the driver to actually take it back rather than returning into a race: the caller's next
# move is to reconnect sensors, and a premature success sends it at a device that is not there yet.
deadline=$(( SECONDS + ${TIMEOUT%.*} ))
while (( SECONDS < deadline )); do
  if [[ -e "$dev/driver" || -d "$dev/driver" ]]; then
    echo "re-bound: $port ($ident)"
    exit 0
  fi
  sleep 0.2
done
echo "$port did not re-bind within ${TIMEOUT}s" >&2
exit 5
