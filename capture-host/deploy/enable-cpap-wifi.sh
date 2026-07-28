#!/usr/bin/env bash
# tepna-capture — deploy/enable-cpap-wifi.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Make the CPAP harvest able to associate to the ez Share card. Two host facts have to be true, neither
# of which a stock Ubuntu box provides, and both of which were found the hard way on 2026-07-28 after
# the harvest had silently stopped pulling:
#
#   1. THE Wi-Fi INTERFACE MUST BE networkd-UNMANAGED. /etc/systemd/network is empty on a stock box and
#      dracut leaves /run/systemd/network/zzzz-dracut-default.network behind, matching EVERY
#      non-loopback interface. networkd therefore claims the Wi-Fi too and reports
#      `State: off (configured)` while holding the link DOWN. The harvest's own `ip link set … up`
#      succeeds and networkd puts it straight back down, so wpa_supplicant sits at
#      `wpa_state=INTERFACE_DISABLED` and can never associate.
#
#   2. THE SERVICE NEEDS A WRITABLE /tmp. `wpa_cli` creates its own CLIENT socket under /tmp, and the
#      unit runs ProtectSystem=strict, so every status poll fails with
#      `Failed to connect to non-global ctrl_ifname: … Read-only file system` even when the supplicant
#      is up and its sockets exist. PrivateTmp=yes gives the service a private writable /tmp, which
#      INCREASES isolation rather than relaxing it.
#
# ⚠ AND THE CASE THIS SCRIPT EXISTS TO REFUSE. On a box with no Ethernet the Wi-Fi radio IS the uplink.
# Marking it unmanaged, or letting the harvest take it down to talk to an SD card, disconnects the box —
# to fetch a file. That is the exact trade `wifi_up`'s default-route guard forbids at runtime, and this
# script forbids it at install time rather than letting someone discover it from a silent box. Those
# deployments need a SECOND radio, or a card in station mode (which needs no association at all — see
# cpap_harvest.reachable).
#
# Idempotent. `--check` reports and changes nothing. Needs root only to write /etc.
set -euo pipefail

IFACE=""
CHECK=0
UNIT="${TEPNA_ETC_SYSTEMD:-/etc/systemd/system}"
NETD="${TEPNA_ETC_NETWORKD:-/etc/systemd/network}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --iface) IFACE="${2:-}"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# The device carrying the default route — the box's lifeline. Everything below is about not breaking it.
uplink() { ip route show default 2>/dev/null | awk '/^default/{for(i=1;i<NF;i++) if($i=="dev") print $(i+1); exit}'; }

# Wireless interfaces, by the one test that does not need `iw` installed: /sys marks them with a
# `wireless` directory. Probing rather than pattern-matching `wl*`, because names are not a contract.
wifi_ifaces() {
  local d
  for d in /sys/class/net/*; do
    [ -d "$d/wireless" ] && basename "$d"
  done
}

UP="$(uplink || true)"
if [ -z "$IFACE" ]; then
  for c in $(wifi_ifaces); do
    [ "$c" = "$UP" ] && continue          # never auto-pick the lifeline
    IFACE="$c"; break
  done
fi

if [ -z "$IFACE" ]; then
  echo "✗ no usable Wi-Fi interface found."
  echo "  wireless interfaces : $(wifi_ifaces | tr '\n' ' ')"
  echo "  default route       : ${UP:-none}"
  echo
  echo "  If the only radio is your uplink, this box cannot lend it to the CPAP harvest without"
  echo "  disconnecting itself. Use a second Wi-Fi adapter, or put the ez Share card in station mode"
  echo "  so it joins your network and needs no association at all (set cpap.base_url to its address)."
  exit 1
fi

if [ "$IFACE" = "$UP" ]; then
  echo "✗ refusing: '$IFACE' carries the default route — it is this box's lifeline."
  echo
  echo "  Marking it unmanaged, or letting the harvest take it down to reach an SD card, disconnects"
  echo "  the box to fetch a file. Use a second Wi-Fi adapter (--iface <other>), or put the card in"
  echo "  station mode so no association is needed at all."
  exit 1
fi

echo "  Wi-Fi for CPAP : $IFACE"
echo "  uplink (kept)  : ${UP:-none}"

NET_DST="$NETD/10-tepna-cpap-wifi.network"
DROPIN_DIR="$UNIT/tepna-capture.service.d"
DROPIN="$DROPIN_DIR/10-cpap-privatetmp.conf"
NET_BODY="$(sed "s/@IFACE@/$IFACE/" "$SRC/systemd/10-tepna-cpap-wifi.network.example")"
DROPIN_BODY="# Installed by deploy/enable-cpap-wifi.sh — wpa_cli puts its CLIENT socket under /tmp, which
# ProtectSystem=strict makes read-only. PrivateTmp gives the service its own writable /tmp; it
# tightens isolation rather than loosening it.
[Service]
PrivateTmp=yes
"

net_ok=0; dropin_ok=0
[ -f "$NET_DST" ] && [ "$(cat "$NET_DST")" = "$NET_BODY" ] && net_ok=1
# Compare through command substitution on BOTH sides: `$(cat …)` strips trailing newlines, so a
# literal that ends in one never matches the file it just wrote — the install would be "stale" forever
# and re-run on every invocation.
[ -f "$DROPIN" ] && [ "$(cat "$DROPIN")" = "$(printf '%s' "$DROPIN_BODY")" ] && dropin_ok=1

echo "  $NET_DST : $([ $net_ok = 1 ] && echo 'in sync' || echo 'MISSING or STALE')"
echo "  $DROPIN : $([ $dropin_ok = 1 ] && echo 'in sync' || echo 'MISSING or STALE')"

if [ "$CHECK" = "1" ]; then
  [ $net_ok = 1 ] && [ $dropin_ok = 1 ] && exit 0
  echo; echo "  run without --check to install (needs root)"
  exit 1
fi
if [ $net_ok = 1 ] && [ $dropin_ok = 1 ]; then
  echo; echo "✓ already configured — nothing to do."
  exit 0
fi

mkdir -p "$NETD" "$DROPIN_DIR"
printf '%s\n' "$NET_BODY" > "$NET_DST"
printf '%s' "$DROPIN_BODY" > "$DROPIN"
echo "  installed."

# Reload only when writing to the REAL host paths — a redirected install (tests) must never touch the
# developer's own systemd, which is the §E6 lesson check-system-files.sh already carries.
if [ "$NETD" = "/etc/systemd/network" ]; then
  networkctl reload 2>/dev/null && echo "  networkd reloaded (the wired uplink keeps its lease)"
fi
if [ "$UNIT" = "/etc/systemd/system" ]; then
  systemctl daemon-reload 2>/dev/null && echo "  systemd units reloaded"
  echo
  echo "  PrivateTmp only takes effect on a RESTART — do it when nothing is streaming:"
  echo "      systemctl restart tepna-capture"
fi
