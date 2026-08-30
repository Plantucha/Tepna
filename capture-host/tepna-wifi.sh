#!/usr/bin/env bash
# tepna-capture — tepna-wifi.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# NOPASSWD-sudo helper: bring the box's Wi-Fi UPLINK up or down. Scanning, associating and DHCP all
# need root, and this exists as a tiny fixed-surface helper rather than a blanket grant on
# wpa_supplicant/dhcpcd — the same reasoning as tepna-rssi.sh.
#
#   DEPLOY ROOT-OWNED (never grant sudo on the in-repo copy — it sits on a user-writable mount):
#     sudo install -D -o root -g root -m0755 <repo>/capture-host/tepna-wifi.sh \
#          /usr/local/lib/tepna/tepna-wifi.sh
#   The existing sudoers line already covers it: (root) NOPASSWD: /usr/local/lib/tepna/*
#
# 🔴 THE PSK IS READ FROM STDIN, NEVER FROM ARGV. Every argument of every process is world-readable
# through /proc/<pid>/cmdline, so a key passed as `$3` is visible to any local user for the lifetime
# of the call — and to anything sampling `ps`. It arrives on stdin and is written straight into a
# 0600 file.
#
# ⚠️ THIS IS THE UPLINK, NOT THE EZ-SHARE HARVEST. The harvest runs its OWN supplicant against the SD
# card's AP with its own control directory; two supplicants sharing one ctrl_interface break each
# other (cpap_harvest's header records that at length). This one uses /run/tepna-uplink and the
# harvest must be suspended before it runs — one radio, one owner at a time.
set -uo pipefail

IFACE="${TEPNA_WIFI_IFACE:-wlp1s0}"
CTRL="/run/tepna-uplink"
CONF="/run/tepna-uplink.conf"

die() { echo "$1" >&2; exit "${2:-1}"; }

# `wpa_cli` pinned to OUR control directory on every call — a bare invocation resolves through the
# system daemon's directory and would talk to the wrong supplicant.
wcli() { wpa_cli -p "$CTRL" -i "$IFACE" "$@" 2>/dev/null; }

ensure_supplicant() {
  if wcli status >/dev/null 2>&1; then return 0; fi
  mkdir -p "$CTRL"
  # A scan needs a running supplicant but not a configured network, so an empty config is enough to
  # get the control socket up. `update_config=1` lets a later `save_config` persist what we add.
  if [ ! -s "$CONF" ]; then
    printf 'ctrl_interface=%s\nupdate_config=1\n' "$CTRL" > "$CONF"
    chmod 0600 "$CONF"
  fi
  ip link set "$IFACE" up || die "cannot bring up $IFACE" 2
  wpa_supplicant -B -i "$IFACE" -c "$CONF" >/dev/null 2>&1
  # A non-zero exit is NOT a failed start — an already-running instance also exits non-zero, and the
  # status check below is what actually decides. Same trap cpap_harvest records for the ez-share path.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    wcli status >/dev/null 2>&1 && return 0
    sleep 0.4
  done
  die "supplicant did not create a control socket on $IFACE" 3
}

case "${1:-}" in
  scan)
    ensure_supplicant
    wcli scan >/dev/null
    sleep 3
    wcli scan_results
    ;;
  join)
    # usage: join <ssid>   ...with the 64-hex PSK (or the word OPEN) on stdin
    SSID="${2:-}"
    [ -n "$SSID" ] || die "join needs an ssid" 4
    read -r PSK || true
    case "$PSK" in
      OPEN) NETBLOCK=$(printf 'network={\n\tssid="%s"\n\tkey_mgmt=NONE\n}\n' "$SSID") ;;
      [0-9a-fA-F]*)
        [ "${#PSK}" -eq 64 ] || die "psk must be 64 hex characters (derive it with wpa_passphrase)" 5
        NETBLOCK=$(printf 'network={\n\tssid="%s"\n\tpsk=%s\n}\n' "$SSID" "$PSK") ;;
      *) die "psk must be 64 hex characters, or the word OPEN" 5 ;;
    esac
    mkdir -p "$CTRL"
    printf 'ctrl_interface=%s\nupdate_config=1\n\n%s' "$CTRL" "$NETBLOCK" > "$CONF"
    chmod 0600 "$CONF"          # the PSK is in here; never world-readable
    # Restart cleanly onto the new config rather than reconfiguring in place: a stale association to
    # a previous network is exactly the state a "connect" button must not leave behind.
    wcli terminate >/dev/null 2>&1
    sleep 1
    ensure_supplicant
    for _ in $(seq 1 30); do
      wcli status 2>/dev/null | grep -q '^wpa_state=COMPLETED' && break
      sleep 1
    done
    wcli status 2>/dev/null | grep -q '^wpa_state=COMPLETED' || die "did not associate to $SSID" 6
    dhcpcd -n "$IFACE" >/dev/null 2>&1 || dhcpcd "$IFACE" >/dev/null 2>&1 || true
    ip -br addr show "$IFACE"
    ;;
  leave)
    wcli terminate >/dev/null 2>&1
    dhcpcd -k "$IFACE" >/dev/null 2>&1 || true
    ip addr flush dev "$IFACE" >/dev/null 2>&1 || true
    ip link set "$IFACE" down >/dev/null 2>&1 || true
    rm -f "$CONF"
    echo "down"
    ;;
  status)
    # No `ensure_supplicant` here: status must never START anything. A question about the uplink that
    # brings the uplink up is not a question, and would fight the harvest for the radio.
    wcli status 2>/dev/null || echo "wpa_state=INTERFACE_DISABLED"
    ip -br addr show "$IFACE" 2>/dev/null || true
    ;;
  *)
    die "usage: tepna-wifi.sh {scan|join <ssid>|leave|status}" 64
    ;;
esac
