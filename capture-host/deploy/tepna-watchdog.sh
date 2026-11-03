#!/usr/bin/env bash
# tepna-capture — deploy/tepna-watchdog.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Every 30 min (vigil user crontab): is capture actually WRITING? Correct it if not.
#
# This is the box-local watchdog brought into the tree (residue
# 2026-11-02-the-box-watchdog-restarts-for-an-explained-silence), so a later fix deploys through
# tepna-update instead of a hand edit on the box. Its behaviour is the box copy's, with ONE change: a
# connected device that is silent is not a fault when the daemon's own status file explains the
# silence (watchdog_silence.py: charging, not worn, an offline op named by `gates`, a radio recovery,
# a shutdown). The decisions live in that module, where tests reach them.
#
# The daemon already ALERTS. Alerting is not correcting, and an alert at 03:00 wakes nobody. This acts,
# within strict bounds.
#
# WHAT IT WILL DO
#   * daemon not active            -> restart
#   * status.json older than 6 min -> restart (the daemon is wedged, not merely idle)
#   * a device connected, its last_sample older than 20 min, and nothing in the status file explains
#     it -> restart (a dead stream that still reports "connected" is what a connected-flag misses)
#   * BlueZ `InProgress` on two consecutive cycles -> radio reset (own budget, see below)
#
# WHAT IT WILL NOT DO — deliberately
#   * never STOP capture and leave it stopped (no probing, no link stealing)
#   * never more than MAX_FIX restarts per day. A restart that does not help will not help on the
#     fourth attempt either, and a restart loop destroys more data than the fault it chases.
#   * never touch device files, the corpus, or git.
#   * a device that is simply ABSENT (off charger, out of range, not worn) is NOT a fault, and neither
#     is a silence the daemon chose and named.
#
# Paths: TEPNA_CAPTURES (default /srv/tepna/captures; persistent — /tmp is wiped by reboot),
# TEPNA_PY (default the capture-host venv beside this script), TEPNA_RESTART (the NOPASSWD helper).
set -uo pipefail
HOST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CAP=${TEPNA_CAPTURES:-/srv/tepna/captures}
S=$CAP/status.json
LOG=$CAP/watchdog.log
STATE=$CAP/.watchdog-fixes
UNIT=tepna-capture.service
MAX_FIX=3
WEDGE=$CAP/.watchdog-wedge   # consecutive cycles seeing an adapter wedge
MAX_RADIO=2                  # bluetooth service restarts per day, own budget
PY=${TEPNA_PY:-$HOST_DIR/.venv/bin/python}
RESTART=${TEPNA_RESTART:-/usr/local/lib/tepna/tepna-restart.sh}
DECIDE=$HOST_DIR/watchdog_silence.py

log() { printf '%s %s\n' "$(date -Is)" "$1" >> "$LOG"; }

# fix counter resets each calendar day
today=$(date +%F)
if [ -f "$STATE" ]; then read -r day n < "$STATE"; else day=$today; n=0; fi
[ "$day" != "$today" ] && { day=$today; n=0; }

fix() {
  if [ "$n" -ge "$MAX_FIX" ]; then
    log "WOULD-FIX ($1) but already used $n/$MAX_FIX restarts today — standing down, not looping"
    return
  fi
  n=$((n+1)); printf '%s %s\n' "$today" "$n" > "$STATE"
  log "FIXING ($1) — restart $n/$MAX_FIX"
  # shellcheck disable=SC2024  # the log is the cron user own file: the redirect is meant to run unprivileged
  sudo -n "$RESTART" restart >>"$LOG" 2>&1
  sleep 25
  log "after restart: daemon=$(systemctl is-active "$UNIT")"
}

# ── ADAPTER WEDGE — a HOST fault wearing the shape of an absent device ──────────────────────────────
# BlueZ reports `org.bluez.Error.InProgress` on the next scan after a disconnect, while `bluetoothctl
# show` still says `Discovering: no`. The daemon then reports the device as simply not connected, and
# every check below treats an absent device as "not faulty" — correctly, since a ring off the finger
# must not trigger restarts. So a wedged adapter can block reconnection indefinitely and nothing acts.
#
# RESTARTING THE DAEMON DOES NOT FIX IT. Measured 2026-08-03: the stuck state lives in bluetoothd, not
# in a client — only `tepna-restart.sh radio` (which restarts the service) cleared it. So this
# escalates differently from every other fault here, and carries its own budget.
#
# Requires TWO consecutive sightings: the daemon retries on its own and usually clears a transient.
wedged=""
[ -f "$S" ] && wedged=$("$PY" "$DECIDE" wedged "$S" 2>>"$LOG")
if [ -f "$WEDGE" ]; then read -r wday wn < "$WEDGE"; else wday=$today; wn=0; fi
[ "$wday" != "$today" ] && { wday=$today; wn=0; }
if [ -n "$wedged" ]; then
  wn=$((wn+1)); printf '%s %s\n' "$today" "$wn" > "$WEDGE"
  log "adapter wedge seen (${wn}x consecutive): $wedged"
  if [ "$wn" -ge 2 ]; then
    rday=$today; rn=0
    [ -f "$WEDGE.radio" ] && read -r rday rn < "$WEDGE.radio"
    [ "$rday" != "$today" ] && { rday=$today; rn=0; }
    if [ "$rn" -lt "$MAX_RADIO" ]; then
      rn=$((rn+1)); printf '%s %s\n' "$today" "$rn" > "$WEDGE.radio"
      log "FIXING (adapter wedge) — radio reset $rn/$MAX_RADIO; a daemon restart does NOT clear this"
      # shellcheck disable=SC2024  # same: an unprivileged append to the user log
      sudo -n "$RESTART" radio >>"$LOG" 2>&1
      sleep 15
      printf '%s 0\n' "$today" > "$WEDGE"
      log "after radio reset: bluetooth=$(systemctl is-active bluetooth 2>/dev/null) daemon=$(systemctl is-active "$UNIT")"
    else
      log "WOULD-FIX (adapter wedge) but radio resets exhausted $rn/$MAX_RADIO — standing down"
    fi
  fi
else
  printf '%s 0\n' "$today" > "$WEDGE"
fi

if ! systemctl is-active --quiet "$UNIT"; then
  log "FAULT daemon inactive"; fix "daemon inactive"; printf '%s %s\n' "$day" "$n" > "$STATE"; exit 0
fi

if [ ! -f "$S" ]; then log "FAULT no status.json"; fix "no status.json"; exit 0; fi

age=$(( $(date +%s) - $(stat -c %Y "$S") ))
if [ "$age" -gt 360 ]; then
  log "FAULT status.json stale ${age}s"; fix "status stale ${age}s"; exit 0
fi

# A device that claims connected but stopped producing samples is the case a connected-flag misses.
# The module prints the unexplained faults, a TAB, then the silences the status file explains.
silent=$("$PY" "$DECIDE" silent "$S" 2>>"$LOG")
stale=${silent%%$'\t'*}
explained=""
[[ "$silent" == *$'\t'* ]] && explained=${silent#*$'\t'}
[ -n "$explained" ] && log "SKIP explained silence: $explained"

if [ -n "$stale" ]; then
  log "FAULT connected-but-silent: $stale"; fix "silent stream: $stale"
else
  ok=$("$PY" "$DECIDE" summary "$S" 2>>"$LOG")
  log "OK  status ${age}s old · $ok · fixes $n/$MAX_FIX · wedge ${wn:-0}"
fi
printf '%s %s\n' "$day" "$n" > "$STATE"
