#!/usr/bin/env bash
# tepna-capture — tepna-sniff.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Make the air a MONITORED surface (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05 D3). The box owns an
# nRF Sniffer that nothing scheduled: D1's "no foreign initiator has connected to our devices" was
# measured once, by hand, for 126 minutes of one night. This script turns it into a standing check —
# a bounded all-advertising capture into $TEPNA_SNIFF_DIR, then `ble_sniff.py --expect-seconds
# --config --adapters` judges it: did the sniffer actually run the window (F2's capture died 2 h into
# 7.4 h and nothing said so), and did any initiator that is NOT one of our adapters open a link to one
# of OUR devices (C1's impostor, seen on air rather than inferred). A failed audit exits 3 so the
# oneshot unit lands in `systemctl --failed`.
#
# THE VERDICT READS THE BYTES, NEVER THE EXTCAP'S EXIT CODE. Nordic's nrf_sniffer_ble.py exits 0 on a
# LockedException (someone else holds the serial port), writes a header-only pcap and logs the reason
# at INFO to nowhere; `timeout` exits 124 on the NORMAL end of a capture. Both codes are noise for the
# question being asked, so the script records them and judges the pcap.
#
# UNPRIVILEGED. Runs as vigil (dialout for /dev/ttyACM*, bluetoothctl needs no root to `list`). Uses
# the SYSTEM python for the extcap — pyserial lives in dist-packages, not in the venv — and the venv
# for the audit (yaml). `nice -n 19` because the extcap's capture loop is `while True: pass`: it spins
# a core for the whole window and must yield to the capture daemon.
#
#   unit:   systemd/tepna-sniff.service + .timer (nightly; installed by deploy/install-services.sh)
#   manual: tepna-sniff.sh                       → same thing, now; exit 0 clean · 3 audit failed ·
#                                                  5 no sniffer on the bus · 6 extcap missing
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${TEPNA_SNIFF_DIR:-/srv/tepna/captures/sniffer}"
SECS="${TEPNA_SNIFF_SECONDS:-600}"
KEEP_DAYS="${TEPNA_SNIFF_KEEP_DAYS:-30}"
EXTCAP="${TEPNA_SNIFF_EXTCAP:-$HOME/.config/wireshark/extcap/nrf_sniffer_ble.py}"
CONFIG="${TEPNA_CONFIG:-$here/config.yaml}"
SYS_PY="${TEPNA_SNIFF_PY:-/usr/bin/python3}"
VENV_PY="$here/.venv/bin/python"; [ -x "$VENV_PY" ] || VENV_PY="python3"
log() { echo "tepna-sniff: $*" >&2; logger -t tepna-sniff -- "$*" 2>/dev/null || true; }

[[ "$SECS" =~ ^[0-9]+$ ]] && [ "$SECS" -gt 0 ] || { log "bad TEPNA_SNIFF_SECONDS: $SECS"; exit 2; }
[ -f "$EXTCAP" ] || { log "extcap missing: $EXTCAP — install the nRF Sniffer extcap for this user"; exit 6; }

# The sniffer by its STABLE by-id name, never /dev/ttyACM0 by assumption: the CPAP link and a
# flashed nRF52840 HCI dongle can both enumerate as ttyACMn, and the number follows plug order.
tty="${TEPNA_SNIFF_TTY:-}"
if [ -z "$tty" ]; then
  for link in /dev/serial/by-id/usb-ZEPHYR_nRF_Sniffer_for_Bluetooth_LE_*; do
    [ -e "$link" ] && tty="$(readlink -f "$link")" && break
  done
fi
[ -n "$tty" ] && [ -e "$tty" ] || { log "no nRF Sniffer on the bus (/dev/serial/by-id has no ZEPHYR_nRF_Sniffer entry)"; exit 5; }

mkdir -p "$OUT_DIR"
stamp="$(date -u +%Y%m%d-%H%M)"
pcap="$OUT_DIR/nightly-$stamp.pcap"
log "capture start: $SECS s all-advertising on $tty -> $pcap"
rc=0
nice -n 19 timeout -s INT -k 15 "$SECS" "$SYS_PY" "$EXTCAP" --capture \
  --extcap-interface "$tty-None" --fifo "$pcap" --device "" \
  --scan-follow-rsp --scan-follow-aux >/dev/null 2>&1 || rc=$?
# 124 = timeout ended it on schedule (the normal case); anything else is recorded, not judged.
[ "$rc" -eq 124 ] || log "extcap exited $rc before the window ended (judging the pcap regardless)"

# Our own radios, so a connect from one of them is attributed rather than flagged. An empty list is
# passed through as-is: ble_sniff then reports every connect to our devices as foreign, which is the
# honest reading of "could not attribute".
adapters=""
if command -v bluetoothctl >/dev/null 2>&1; then
  adapters="$(bluetoothctl list 2>/dev/null | awk '$1=="Controller"{print $2}' | paste -sd, - || true)"
fi

# rc 124 means `timeout` ended the capture ON SCHEDULE, i.e. the process lived the whole window — so
# a short span is the sniffer falling BEHIND real time, not dying. Measured on vigil 2026-09-06: the
# extcap pegs a core at 101 %, runs at ~0.4x, and the missing time is always the END of the window.
# The audit cannot tell those apart from the pcap, so the exit code is handed to it.
# EXACTLY ONE of the two is passed, because the audit must be able to tell "it ended early" from "the
# caller did not say". rc 124 is `timeout` ending it on schedule; anything else is a real early exit.
if [ "$rc" -eq 124 ]; then ran_full="--ran-full-window"; else ran_full="--exited-early"; fi
verdict="$pcap.verdict.txt"
arc=0
# shellcheck disable=SC2086 # $ran_full is one optional flag or empty; quoting it would pass ""
"$VENV_PY" "$here/ble_sniff.py" "$pcap" --expect-seconds "$SECS" --config "$CONFIG" \
  --adapters "$adapters" $ran_full >"$verdict" 2>&1 || arc=$?
head -1 "$verdict" | sed 's/^/tepna-sniff: /' >&2
audit_line="$(grep -m1 '^AIR AUDIT' "$verdict" || echo "AIR AUDIT: not produced (ble_sniff exit $arc)")"
log "$audit_line — $verdict"

# Retention, scoped to the files THIS script names. Nothing else in the directory is touched.
find "$OUT_DIR" -maxdepth 1 -type f -name 'nightly-*.pcap*' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
exit "$arc"
