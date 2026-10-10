#!/usr/bin/env bash
# tepna-capture — deploy/enable-gps-stratum1.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Make the capture box a STRATUM-1 time server on its own GPS, the LAN's standard way (VIGIL-GPS-STRATUM1-
# 2026-10-10; wiring in docs/VIGIL-GPS-STRATUM1.md). Idempotent; re-run after any hardware change.
#   sudo bash enable-gps-stratum1.sh            install
#   bash enable-gps-stratum1.sh --check         report what is present, write nothing (no root needed)
# What it installs, and nothing else:
#   pps-tools gpsd gpsd-clients               the line-discipline tools, gpsd (position/monitoring only)
#   tepna-pps-ldattach.service                DCD on ttyS0 → /dev/pps0
#   /etc/default/gpsd                         NMEA on the CP2102 at 38400 (the M10's default, NOT 9600)
#   /usr/local/lib/tepna/tepna-m10-tune.sh    receiver tuning, re-applied at every gpsd start
#   /etc/chrony/conf.d/tepna-gps-pps.conf     refclock PPS prefer · allow LAN · local orphan (as digipi)
# Test seams (tests/test_gps_stratum1_sh.py): TEPNA_ETC_SYSTEMD, TEPNA_ETC_CHRONY, TEPNA_ETC_DEFAULT, TEPNA_LIB_DIR
# and TEPNA_DEV_ROOT redirect every path the script touches; with any seam set the root check is skipped, because
# the only thing root is needed for is the real /etc. Stub apt-get/systemctl/chronyc/journalctl/ip on PATH.
# TEPNA_LAN_CIDR sets the subnet the chrony drop-in serves; unset, it is the subnet of the default-route
# interface, so the repo never carries the network layout (the shipped conf holds @LAN_CIDR@).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"                 # capture-host/
UNIT_DIR="${TEPNA_ETC_SYSTEMD:-/etc/systemd/system}"
CHRONY_DIR="${TEPNA_ETC_CHRONY:-/etc/chrony/conf.d}"
DEFAULT_DIR="${TEPNA_ETC_DEFAULT:-/etc/default}"
DST="${TEPNA_LIB_DIR:-/usr/local/lib/tepna}"  # helper_path.SYSTEM_DIRS[0]; root-owned, never user-writable
DEVROOT="${TEPNA_DEV_ROOT:-}"                 # prefix for /dev and /sys in tests
LAN_CIDR="${TEPNA_LAN_CIDR:-}"                # the subnet chrony serves; derived from the default route when unset
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1
SEAMED=0
[ -n "${TEPNA_ETC_SYSTEMD:-}${TEPNA_ETC_CHRONY:-}${TEPNA_ETC_DEFAULT:-}${TEPNA_LIB_DIR:-}${TEPNA_DEV_ROOT:-}" ] && SEAMED=1
if [ "$CHECK" = 0 ] && [ "$SEAMED" = 0 ] && [ "$(id -u)" != 0 ]; then echo "run with sudo: sudo bash $0"; exit 1; fi
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
lan_cidr() {  # the default-route interface's subnet as a network: a.b.c.d/24 → a.b.c.0/24
  local dev addr
  dev=$(ip -4 route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
  [ -n "$dev" ] || return 1
  addr=$(ip -4 -o addr show dev "$dev" 2>/dev/null | awk '{print $4; exit}')
  [ -n "$addr" ] || return 1
  python3 -c 'import ipaddress,sys; print(ipaddress.ip_interface(sys.argv[1]).network)' "$addr"
}

say "0/6  preconditions (read-only)"
if [ ! -e "$DEVROOT/dev/ttyS0" ]; then
  echo "  ✗ /dev/ttyS0 missing — enable Serial Port 1 in BIOS (Devices → Serial Port Setup)"; exit 1
fi
echo "  ttyS0 type=$(cat "$DEVROOT/sys/class/tty/ttyS0/type" 2>/dev/null) port=$(cat "$DEVROOT/sys/class/tty/ttyS0/port" 2>/dev/null) irq=$(cat "$DEVROOT/sys/class/tty/ttyS0/irq" 2>/dev/null)   (type 4 = 16550A)"
if [ -e "$DEVROOT/dev/ttyUSB0" ]; then echo "  ✓ /dev/ttyUSB0 present (CP2102)"; else echo "  ⚠ /dev/ttyUSB0 absent — NMEA/position will be missing; the PPS alone still disciplines the clock"; fi
if [ "$CHECK" = 1 ]; then
  for f in "$UNIT_DIR/tepna-pps-ldattach.service" "$DEFAULT_DIR/gpsd" "$DST/tepna-m10-tune.sh" "$CHRONY_DIR/tepna-gps-pps.conf"; do
    if [ -f "$f" ]; then echo "  present  $f"; else echo "  missing  $f"; fi
  done
  if [ -e "$DEVROOT/dev/pps0" ]; then echo "  present  /dev/pps0"; else echo "  missing  /dev/pps0 (attached by the unit)"; fi
  echo; echo "  run without --check to install (needs root)"; exit 0
fi

say "1/6  packages"
if apt-get install -y pps-tools gpsd gpsd-clients >/dev/null; then echo "  ✓ pps-tools gpsd gpsd-clients"; else echo "  ✗ apt-get failed (offline?) — continuing; the units need pps-tools and gpsd present"; fi

say "2/6  PPS line discipline unit"
mkdir -p "$UNIT_DIR"
install -m 0644 "$SRC/systemd/tepna-pps-ldattach.service" "$UNIT_DIR/tepna-pps-ldattach.service"
systemctl daemon-reload
systemctl enable --now tepna-pps-ldattach.service
sleep 1
if [ -e "$DEVROOT/dev/pps0" ]; then
  echo "  ✓ /dev/pps0  assert=$(cut -d'#' -f2 "$DEVROOT/sys/class/pps/pps0/assert" 2>/dev/null) pulses so far"
else
  echo "  ✗ /dev/pps0 did not appear:"; journalctl -u tepna-pps-ldattach -n 5 --no-pager | sed 's/^/    /'
fi

say "3/6  gpsd (NMEA at 38400 on the CP2102 — position and monitoring only; the clock does not depend on it)"
mkdir -p "$DEFAULT_DIR" "$DST" "$UNIT_DIR/gpsd.service.d"
cat > "$DEFAULT_DIR/gpsd" <<'EOF'
# Tepna Vigil — written by deploy/enable-gps-stratum1.sh
START_DAEMON="true"
USBAUTO="false"
DEVICES="/dev/ttyUSB0"
GPSD_OPTIONS="-n -s 38400"
EOF
install -m 0755 "$SRC/tepna-m10-tune.sh" "$DST/tepna-m10-tune.sh"
printf '[Service]\nExecStartPre=-%s/tepna-m10-tune.sh /dev/ttyUSB0 38400\n' "$DST" > "$UNIT_DIR/gpsd.service.d/tepna-m10-tune.conf"
systemctl daemon-reload
systemctl enable gpsd.service >/dev/null 2>&1
if systemctl restart gpsd.service; then echo "  ✓ gpsd restarted"; else echo "  ✗ gpsd did not restart"; fi

say "4/6  chrony: refclock PPS prefer · allow LAN · local orphan (the digipi shape)"
mkdir -p "$CHRONY_DIR"
# Retire the bring-up drop-in that used `lock GPS` + SHM, if the first-night script left one behind.
if [ -f "$CHRONY_DIR/gps-pps.conf" ]; then
  mv "$CHRONY_DIR/gps-pps.conf" "$CHRONY_DIR/gps-pps.conf.bak-lockgps"; echo "  retired gps-pps.conf (lock GPS) → .bak-lockgps"
fi
if [ -z "$LAN_CIDR" ]; then
  if ! LAN_CIDR=$(lan_cidr) || [ -z "$LAN_CIDR" ]; then
    echo "  ✗ cannot derive the LAN subnet (no default route?) — set TEPNA_LAN_CIDR=<cidr> and re-run"; exit 1
  fi
fi
sed "s|@LAN_CIDR@|$LAN_CIDR|" "$SRC/systemd/tepna-gps-pps.chrony.conf" > "$CHRONY_DIR/tepna-gps-pps.conf"
chmod 0644 "$CHRONY_DIR/tepna-gps-pps.conf"
echo "  allow $LAN_CIDR"
if systemctl restart chrony; then echo "  ✓ chrony restarted"; else echo "  ✗ chrony did not restart"; fi

say "5/6  verify (30 s for the first PPS samples)"
sleep 30
chronyc sources -v | tail -n +2
chronyc tracking | grep -E "Reference ID|Stratum|System time|RMS offset"

say "6/6  what to expect"
cat <<'EOF'
  · within ~10 min: `#* PPS` selected, Stratum 1, System time within a few µs, then sub-µs.
  · the monitor's Clock & NTP card lists every source minus this box; the sidebar pill adds "vs <server>".
  · LAN clients may now add this box beside the other stratum-1 servers (`server <this-ip> iburst`).
  · optional latency trim: `cpupower frequency-set -g performance`; GRUB `intel_idle.max_cstate=1`;
    measure `chronyc sourcestats` PPS std-dev a day before and a day after.
EOF
