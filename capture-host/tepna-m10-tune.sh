#!/bin/sh
# tepna-capture — tepna-m10-tune.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Receiver tuning for the u-blox M10 that times the capture box (VIGIL-GPS-STRATUM1-2026-10-10). The module
# has no flash and the board no backup cell, so every setting vanishes at power-off; gpsd's unit runs this
# as ExecStartPre at every start. Best-effort by design: a receiver that is still booting, or an absent
# ubxtool, must never keep gpsd from starting — the clock does not depend on gpsd at all (chrony takes the
# pulse from /dev/pps0 and the second from the network). Always exits 0.
#   $1 device (default /dev/ttyUSB0) · $2 baud (default 38400 — the M10's default; the REV F sheet's 9600 is wrong)
#   TEPNA_UBXTOOL  test seam: the ubxtool to run (default: `ubxtool` on PATH)
DEV="${1:-/dev/ttyUSB0}"
BAUD="${2:-38400}"
UBX="${TEPNA_UBXTOOL:-ubxtool}"
if ! command -v "$UBX" >/dev/null 2>&1; then echo "tepna-m10-tune: ubxtool not installed, receiver left at defaults"; exit 0; fi
# Stationary dynamic model (2): the box never moves; the receiver's position filter tightens and the PPS
# edge jitter drops. Three attempts — the first can land while the receiver is still booting.
n=0
while [ "$n" -lt 3 ]; do
  n=$((n + 1))
  if "$UBX" -f "$DEV" -s "$BAUD" -z CFG-NAVSPG-DYNMODEL,2 >/dev/null 2>&1; then break; fi
  sleep 2
done
# Silence the three NMEA sentences nothing here reads (satellite lists, lat/lon-only, course/speed): less
# serial traffic, less gpsd parsing, no change to the fix. Each is independent; a refusal is not an error.
for m in GSV GLL VTG; do
  "$UBX" -f "$DEV" -s "$BAUD" -z "CFG-MSGOUT-NMEA_ID_${m}_UART1,0" >/dev/null 2>&1 || true
done
exit 0
