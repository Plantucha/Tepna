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
# 🔴 NOT /run, AND THAT IS THE WHOLE POINT OF THIS LINE.
# The daemon runs under `ProtectSystem=strict` with `ReadWritePaths=/srv/tepna /opt/tepna/capture-host`,
# which makes the ENTIRE hierarchy read-only apart from those two — /run included. This helper is
# invoked through `sudo -n` BY that daemon, and sudo does not create a new mount namespace, so the
# helper runs as root INSIDE the daemon's sandbox and inherits its read-only /run. Measured on vigil
# 2026-08-30, straight after the sudoers grant was installed:
#
#     mkdir: Read-only file system
#     /usr/local/lib/tepna/tepna-wifi.sh: line 45: /run/tepna-uplink.conf: Read-only file system
#
# Being root is not the missing permission; the mount is. ⚠️ `PrivateTmp=yes` is NOT the cause and does
# not fix it — that governs /tmp, and /tmp is writable here precisely because of it.
#
# Why `/srv/tepna/run` rather than a `RuntimeDirectory=tepna` drop-in, which is the tidier systemd
# idiom: this path is ALREADY in ReadWritePaths, so it needs no unit change, no daemon-reload and no
# second root command — and unlike a RuntimeDirectory it survives a daemon restart, which matters
# because the supplicant is long-lived and losing its control socket would leave an uplink we can see
# but no longer steer. It is not archived (`archive-pull.sh` pulls `captures/` only) and not served
# (Caddy roots at `/srv/tepna/app`). Verified on the box: ext4, writable as `vigil`, and a unix control
# socket binds there.
#
# On the credential at rest: the derived PSK is ALREADY persisted on this disk by the remember-network
# feature, so keeping the supplicant's copy beside it adds no exposure that was not already accepted.
# Both are 0600.
#
# `TEPNA_WIFI_RUNDIR` overrides it — that is how the gate exercises this file without writing anywhere real.
RUNDIR="${TEPNA_WIFI_RUNDIR:-/srv/tepna/run}"
CTRL="$RUNDIR/tepna-uplink"
CONF="$RUNDIR/tepna-uplink.conf"

die() { echo "$1" >&2; exit "${2:-1}"; }

# `wpa_cli` pinned to OUR control directory on every call — a bare invocation resolves through the
# system daemon's directory and would talk to the wrong supplicant.
wcli() { wpa_cli -p "$CTRL" -i "$IFACE" "$@" 2>/dev/null; }

ensure_supplicant() {
  # 🔴 THE INTERFACE COMES UP FIRST, BEFORE ANY SHORT-CIRCUIT, AND UNCONDITIONALLY.
  # A live control socket proves a SUPPLICANT EXISTS. It does not prove the radio is enabled, and the
  # two come apart whenever something downs the link while leaving our supplicant running — the CPAP
  # harvest's `wifi_down` does exactly that, and so does a `leave` racing a scan. In that state the old
  # `if wcli status; then return 0` returned early, never ran `ip link set up`, and the scan then ran
  # against a DOWN radio and honestly reported what it saw: nothing.
  #
  # That is the worst shape a failure can take here, because it is indistinguishable from the truth:
  # `ok:true` with an empty list reads as "no networks in range". Measured on vigil 2026-08-30, on the
  # first end-to-end run after the sandbox fix landed — three consecutive scans returned ok:true / 0
  # networks with `wlp1s0` DOWN; terminating the stale supplicant and re-scanning returned 15, the
  # interface flags going from <BROADCAST,MULTICAST> to <...,UP> across that one boundary.
  #
  # Idempotent: on an already-up interface this is a no-op costing one syscall.
  ip link set "$IFACE" up || die "cannot bring up $IFACE" 2
  if wcli status >/dev/null 2>&1; then return 0; fi
  mkdir -p "$CTRL"
  # A scan needs a running supplicant but not a configured network, so an empty config is enough to
  # get the control socket up. `update_config=1` lets a later `save_config` persist what we add.
  if [ ! -s "$CONF" ]; then
    printf 'ctrl_interface=%s\nupdate_config=1\n' "$CTRL" > "$CONF"
    chmod 0600 "$CONF"
  fi
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
    # KEYED ON THE OUTPUT, NOT THE EXIT CODE. `wpa_cli` exits 0 while printing nothing when the
    # control socket is gone, so `wcli status || echo …` leaves the caller with an empty string and no
    # state at all — a status call that answered nothing while reporting success.
    st="$(wcli status 2>/dev/null || true)"
    [ -n "$st" ] || st="wpa_state=INTERFACE_DISABLED"
    printf '%s\n' "$st"
    ip -br addr show "$IFACE" 2>/dev/null || true
    ;;
  *)
    die "usage: tepna-wifi.sh {scan|join <ssid>|leave|status}" 64
    ;;
esac
