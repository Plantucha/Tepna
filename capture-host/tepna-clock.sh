#!/bin/sh
# tepna-capture — tepna-clock.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Narrow privileged helper for the monitor's CLOCK controls. The tepna daemon runs NON-root
# (User=tepna), but the Clock Contract (CLAUDE.md §🔒) makes the box's wall clock the source of every
# capture stamp — so the bedside operator must be able to point NTP at a chosen server, set the poll
# cadence, and set the box timezone (the contract needs the real LOCAL zone) from the monitor page.
# This is the ONLY thing granted root, via a single NOPASSWD sudoers line on the box:
#
#     tepna ALL=(root) NOPASSWD: /opt/tepna/capture-host/tepna-clock.sh
#
# Verbs:
#   ntp <maxPollSec> <server> [server ...]   write the timesyncd drop-in + restart the service
#   sync                                     force an immediate re-sync
#   tz <Area/City>                           set the box timezone (timedatectl set-timezone)
# Every input is re-validated HERE (defense in depth; clockcfg.py validates too) so the sudoers grant
# stays safe regardless of the caller.
set -eu

DROPIN=/etc/systemd/timesyncd.conf.d/tepna-ntp.conf

verb="${1:-}"
shift 2>/dev/null || true

case "$verb" in
  ntp)
    maxpoll="${1:-2048}"
    shift 2>/dev/null || true
    [ "$#" -ge 1 ] || { echo "no NTP server given" >&2; exit 2; }
    case "$maxpoll" in ''|*[!0-9]*) echo "bad maxpoll: $maxpoll" >&2; exit 2 ;; esac
    for s in "$@"; do
      # hostname / IPv4 / IPv6 only — reject shell/whitespace metacharacters
      case "$s" in ''|*[!A-Za-z0-9.:-]*) echo "bad server: $s" >&2; exit 2 ;; esac
    done
    mkdir -p "$(dirname "$DROPIN")"
    {
      echo "# Managed by the Tepna Vigil monitor — do not hand-edit."
      echo "[Time]"
      echo "NTP=$*"
      echo "PollIntervalMinSec=32"
      echo "PollIntervalMaxSec=$maxpoll"
    } > "$DROPIN"
    timedatectl set-ntp true
    systemctl restart systemd-timesyncd
    echo "ok: NTP=$* PollIntervalMaxSec=${maxpoll}s"
    ;;
  sync)
    timedatectl set-ntp false
    timedatectl set-ntp true
    systemctl try-restart systemd-timesyncd
    echo "ok: resync triggered"
    ;;
  tz)
    zone="${1:-}"
    # IANA zone names: letters/digits + / _ + - . only (e.g. America/New_York, Etc/UTC)
    case "$zone" in ''|*[!A-Za-z0-9/_.+-]*) echo "bad timezone: $zone" >&2; exit 2 ;; esac
    [ -f "/usr/share/zoneinfo/$zone" ] || { echo "unknown timezone: $zone" >&2; exit 2; }
    timedatectl set-timezone "$zone"
    echo "ok: timezone=$zone"
    ;;
  *)
    echo "usage: $0 ntp <maxPollSec> <server...> | sync | tz <Area/City>" >&2
    exit 2
    ;;
esac
