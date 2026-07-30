#!/usr/bin/env bash
# tepna-restart.sh — Tepna Vigil
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The ONLY thing this does is restart (or report on) the capture daemon. It exists so a deploy can be
# completed without an interactive password: `git pull` puts new code on disk, but the running process
# keeps serving the old code until something restarts it, and `vigil` cannot call systemctl.
#
# That gap is not theoretical. On 2026-07-30 the box sat on `63a0703` — new code pulled, fixes on disk,
# daemon still running the build from before them — because the restart needed a password nobody was
# awake to type. A capture box that cannot complete its own deploy is a box that silently runs stale
# code all night.
#
# WHY A SCRIPT AND NOT A SUDOERS LINE FOR systemctl. A NOPASSWD grant must name something the granted
# user CANNOT rewrite, and it must not be a general-purpose tool. `NOPASSWD: /usr/bin/systemctl` would
# hand `vigil` every unit on the box — including masking the very services that constrain it. This
# script is root-owned 0755 under /usr/local/lib/tepna, takes a fixed verb, and names ONE unit, so the
# blast radius is exactly "restart the capture daemon".
#
# Same reasoning, and the same deploy shape, as tepna-clock.sh / tepna-rssi.sh (enable-clock-control.sh).
set -uo pipefail

UNIT=tepna-capture.service

usage() { echo "usage: $0 {restart|status}" >&2; exit 2; }
[ $# -eq 1 ] || usage

case "$1" in
  restart)
    # `restart`, never `start`: an operator asking for a restart on a stopped unit means "make it run".
    systemctl restart "$UNIT" || exit 1
    # Report the outcome rather than assuming it. A restart that failed to come up must not look like
    # a success to whatever automated deploy called this.
    sleep 3
    state=$(systemctl is-active "$UNIT" 2>/dev/null)
    echo "$UNIT: $state"
    [ "$state" = active ] || exit 1
    ;;
  status)
    echo "$UNIT: $(systemctl is-active "$UNIT" 2>/dev/null) since $(systemctl show "$UNIT" -p ActiveEnterTimestamp --value 2>/dev/null)"
    ;;
  *) usage ;;
esac
