#!/usr/bin/env bash
# tepna-capture — tepna-btmon.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# NOPASSWD-sudo helper: record HCI traffic on ONE adapter for a BOUNDED time, to a file the operator
# names. Read-only with respect to the radio — btmon opens a monitor socket and never transmits.
#
# WHY THIS EXISTS. The O2Ring restart storm cannot be diagnosed from the daemon journal, and the
# reason is structural rather than a matter of log verbosity: when the ring restarts its recording
# session the daemon writes the ring's RTC (`0xC0 SET_UTC_TIME`) *because* of the restart, and both
# events are logged at the same instant. So "our write provoked the next restart" and "the ring
# restarted on its own" emit identical lines, and no amount of extra logging separates them — the
# ordering that decides it happens on the wire, below the application. Measured on the 2026-09-04→05
# storm night: 54 connects, 66 restarts, 65 RTC writes, link surviving a median 45 s, finger contact
# solid at 1 throughout (so not a wear artefact) and 68–80 % of each PPG grid arriving as gaps.
#
# btmon sees both directions on OUR adapter — every ATT write we send, every notification the ring
# sends, and the DISCONNECT REASON byte, which is the single most useful field for a link that keeps
# dying. The nRF sniffer cannot substitute: headless it follows no connection, so it sees advertising
# and CONNECT_INDs but no GATT.
#
# WHY IT NEEDS ROOT, AND WHY THAT IS THE WHOLE REASON THIS FILE EXISTS: `btmon` binds an
# `AF_BLUETOOTH`/`HCI_CHANNEL_MONITOR` socket, which requires CAP_NET_RAW. Verified unprivileged on
# vigil 2026-09-05: "Failed to bind channel: Operation not permitted". The daemon runs with
# CAP_NET_ADMIN only, and widening the daemon's caps to serve a diagnostic would be the wrong trade —
# a bounded helper the operator invokes is the smaller grant.
#
#   DEPLOY ROOT-OWNED (never grant sudo on the in-repo copy — it sits on a user-writable mount):
#     sudo install -D -o root -g root -m0755 <repo>/capture-host/tepna-btmon.sh \
#          /usr/local/lib/tepna/tepna-btmon.sh
#   sudoers:  michal ALL=(root) NOPASSWD: /usr/local/lib/tepna/tepna-btmon.sh
#   usage:    tepna-btmon.sh <hciN> <seconds> <out.btsnoop>
#             seconds is CAPPED (see MAX_S) so a forgotten invocation cannot run for days;
#             the output path must be under /srv/tepna/captures/ so a privileged writer cannot be
#             pointed at an arbitrary file.
set -uo pipefail
MAX_S=${TEPNA_BTMON_MAX_S:-43200}                 # 12 h — one night, not more
# On TEPNA_BTMON_SYSFS / TEPNA_BTMON_OUTROOT: they exist so the tests can drive a fake tree without a
# real adapter or a real /srv, exactly as tepna-btreset.sh's TEPNA_USB_SYSFS does. They are overrides
# for TESTS, never for operators: both default to the real paths, and the confinement check below is
# applied to whatever OUTROOT resolves to, so overriding it cannot widen the guard in production.
SYSFS="${TEPNA_BTMON_SYSFS:-/sys/class/bluetooth}"
OUTROOT="${TEPNA_BTMON_OUTROOT:-/srv/tepna/captures}"
hci="${1:?usage: tepna-btmon.sh <hciN> <seconds> <out.btsnoop>}"
secs="${2:?usage: tepna-btmon.sh <hciN> <seconds> <out.btsnoop>}"
out="${3:?usage: tepna-btmon.sh <hciN> <seconds> <out.btsnoop>}"

# Validate every argument — never pass unchecked strings to a privileged command (tepna-rssi.sh's rule).
[[ "$hci" =~ ^hci[0-9]+$ ]]  || { echo "bad adapter: $hci" >&2; exit 2; }
[[ "$secs" =~ ^[0-9]+$ ]]    || { echo "bad seconds: $secs" >&2; exit 2; }
[ "$secs" -gt 0 ] 2>/dev/null || { echo "bad seconds: $secs" >&2; exit 2; }
[ "$secs" -le "$MAX_S" ]     || { echo "seconds $secs exceeds the $MAX_S cap" >&2; exit 2; }
# No traversal, no symlink games, no writing outside the capture tree.
case "$out" in
  "$OUTROOT"/*) ;;
  *) echo "output must be under $OUTROOT/: $out" >&2; exit 2 ;;
esac
case "$out" in
  *..*) echo "output path may not contain ..: $out" >&2; exit 2 ;;
esac
[ -e "$out" ] && { echo "refusing to overwrite $out" >&2; exit 2; }
[ -d "$(dirname "$out")" ] || { echo "no such directory: $(dirname "$out")" >&2; exit 2; }
# The adapter must exist: btmon on an absent index records an empty file that reads like a quiet night.
[ -d "$SYSFS/$hci" ] || { echo "no such adapter: $hci" >&2; exit 2; }

command -v btmon >/dev/null || { echo "btmon not installed" >&2; exit 2; }
timeout "$secs" btmon -i "$hci" -w "$out"
rc=$?
# 124 is timeout's "ran the full duration", which is SUCCESS here — the capture was time-boxed on
# purpose. Anything else is a real failure and must not be reported as a completed capture.
[ "$rc" -eq 124 ] || [ "$rc" -eq 0 ] || { echo "btmon failed (exit $rc)" >&2; exit "$rc"; }
# Hand the file to the operator account, or the analysis step cannot read what root just wrote.
chown --reference="$(dirname "$out")" "$out" 2>/dev/null || true
sz=$(stat -c%s "$out" 2>/dev/null || echo 0)
echo "captured $sz bytes to $out"
# An empty capture is a RESULT, not a success: say so rather than letting 0 bytes read as "no traffic".
[ "$sz" -gt 0 ] || { echo "WARNING: capture is EMPTY — adapter idle, or the monitor channel was refused" >&2; exit 3; }
