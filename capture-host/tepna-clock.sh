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
#   ntp <maxPollSec> <server> [server ...]   point the time daemon at these servers + apply
#   sync                                     force an immediate re-sync
#   tz <Area/City>                           set the box timezone (timedatectl set-timezone)
# Every input is re-validated HERE (defense in depth; clockcfg.py validates too) so the sudoers grant
# stays safe regardless of the caller.
#
# ⚠️ TWO TIME DAEMONS, AND WRITING TO THE WRONG ONE IS SILENT (2026-07-25). This helper assumed
# systemd-timesyncd. Ubuntu Server and RHEL default to **chrony**, where the old behaviour was the worst
# possible failure mode: `ntp` wrote /etc/systemd/timesyncd.conf.d/tepna-ntp.conf, which chrony NEVER
# READS, and `systemctl restart systemd-timesyncd` failed on a unit that does not exist — so the monitor
# reported the servers saved while the box kept using whatever it had. A control that claims success and
# changes nothing is exactly what this suite exists to prevent, so the daemon is now DETECTED and each
# verb is implemented for both. Mirrors host_clock.parse_chrony_tracking on the read side.
set -eu

# TEST SEAM, AND IT IS INERT UNDER SUDO BY CONSTRUCTION. This script exists to hold a NOPASSWD root
# grant, so an environment-controlled write path would be a privilege-escalation hole: whoever holds the
# grant could point root's `>` at any file on the box. sudo's default `env_reset` already scrubs this
# variable, but defence in depth must not depend on someone else's sudoers. So it is honoured ONLY when
# we are not root — i.e. exactly the case the tests run in, and never the case the grant creates.
# (Same seam, same reason, as TEPNA_ETC_SYSTEMD/TEPNA_ETC_NETWORKD in deploy/enable-cpap-wifi.sh.)
ETC_ROOT=""
if [ "$(id -u)" -ne 0 ] && [ -n "${TEPNA_ETC_ROOT:-}" ]; then ETC_ROOT="$TEPNA_ETC_ROOT"; fi

DROPIN="$ETC_ROOT/etc/systemd/timesyncd.conf.d/tepna-ntp.conf"
# chrony reads `sourcedir /etc/chrony/sources.d` (servers, reloadable WITHOUT a restart via
# `chronyc reload sources`) and `confdir /etc/chrony/conf.d`. Writing sources rather than a full config
# means we never clobber the distro's own chrony.conf.
CHRONY_SOURCES="$ETC_ROOT/etc/chrony/sources.d/tepna.sources"

# Which daemon is actually steering the clock? Prefer what is RUNNING over what is installed — a box can
# have both packages present with only one active.
time_daemon() {
  for u in chrony chronyd; do
    if systemctl is-active "$u" >/dev/null 2>&1; then echo chrony; return; fi
  done
  if systemctl is-active systemd-timesyncd >/dev/null 2>&1; then echo timesyncd; return; fi
  # Nothing active: fall back to whatever is installed, so a stopped daemon is still configurable.
  command -v chronyc >/dev/null 2>&1 && { echo chrony; return; }
  echo timesyncd
}
DAEMON="$(time_daemon)"

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
    if [ "$DAEMON" = chrony ]; then
      # maxpoll is chrony's log2 seconds, not seconds: 2048 s -> 11. Clamp to chrony's legal 0-31.
      mp=11; n="$maxpoll"; i=0
      while [ "$n" -gt 1 ] && [ "$i" -lt 31 ]; do n=$((n / 2)); i=$((i + 1)); done
      [ "$i" -ge 0 ] && [ "$i" -le 31 ] && mp="$i"
      mkdir -p "$(dirname "$CHRONY_SOURCES")"
      {
        echo "# Managed by the Tepna Vigil monitor — do not hand-edit."
        for s in "$@"; do echo "server $s iburst prefer maxpoll $mp"; done
      } > "$CHRONY_SOURCES"
      timedatectl set-ntp true 2>/dev/null || true
      # Reload in place. NOT a restart — see the `sync` verb: a restart unsynchronises the box for ~60 s.
      if chronyc reload sources >/dev/null 2>&1; then
        echo "ok: NTP=$* maxpoll=2^${mp}s (chrony, $CHRONY_SOURCES)"
      else
        echo "wrote $CHRONY_SOURCES but 'chronyc reload sources' failed — chronyd may need a restart" >&2
        exit 1
      fi
    else
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
      echo "ok: NTP=$* PollIntervalMaxSec=${maxpoll}s (timesyncd)"
    fi
    ;;
  sync)
    if [ "$DAEMON" = chrony ]; then
      # `burst` forces immediate measurements WITHOUT discarding discipline; `makestep 0.1 3` then permits
      # a step only if the next few updates show us >0.1 s out. Deliberately NOT a bare `makestep`, and
      # deliberately NOT a service restart: measured on the real box, restarting chrony resets every
      # source to reach 0 and leaves the host UNSYNCHRONISED for ~60 s. On a box whose whole purpose is
      # stamping captures, briefly destroying the clock to "sync" it is worse than reporting a failure.
      # And the old code echoed "makestep" whichever branch ran, so the message could not be trusted.
      if chronyc burst 4/4 >/dev/null 2>&1 && chronyc makestep 0.1 3 >/dev/null 2>&1; then
        echo "ok: resync triggered (chrony burst + conditional step)"
      else
        echo "chronyc could not be reached — is chronyd running?" >&2; exit 1
      fi
    else
      timedatectl set-ntp false
      timedatectl set-ntp true
      systemctl try-restart systemd-timesyncd
      echo "ok: resync triggered (timesyncd)"
    fi
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
    echo "usage: $0 ntp <maxPollSec> <server...> | sync | tz <Area/City>   [daemon: $DAEMON]" >&2
    exit 2
    ;;
esac
