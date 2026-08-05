#!/usr/bin/env bash
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# vigil.sh — start / stop the Tepna Vigil bedside monitor (capture-host) and print the
# URL to point a browser at.  The Vigil monitor is `capture.py --config config.yaml`,
# which serves the webmon live-view at web.host:web.port (default 127.0.0.1:8760).
#
#   ./vigil.sh start        # launch it, print the browser URL(s)
#   ./vigil.sh stop         # stop it
#   ./vigil.sh restart
#   ./vigil.sh status       # is it running? + URL
#   ./vigil.sh url          # just print the URL(s)
#
# Expose it to other devices on your LAN (phone/tablet) without editing the repo config:
#   VIGIL_HOST=0.0.0.0 ./vigil.sh start     # binds all interfaces, announces the LAN IP
#
# Overrides:  VIGIL_DIR=<capture-host path>  VIGIL_CONFIG=<config.yaml>  VIGIL_PY=<python>
set -uo pipefail

# --- locate capture-host (auto if this script sits inside it; else the known path) --------
_self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$_self/capture.py" ]; then
  VIGIL_DIR="${VIGIL_DIR:-$_self}"
else
  VIGIL_DIR="${VIGIL_DIR:-/run/media/michal/647A504F7A50205A/Tepna/capture-host}"
fi
CONFIG="${VIGIL_CONFIG:-$VIGIL_DIR/config.yaml}"
PY="${VIGIL_PY:-$VIGIL_DIR/.venv/bin/python}"
[ -x "$PY" ] || PY="python3"
PIDFILE="${VIGIL_PIDFILE:-${XDG_RUNTIME_DIR:-/tmp}/vigil-monitor.pid}"
LOGFILE="${VIGIL_LOG:-${XDG_RUNTIME_DIR:-/tmp}/vigil-monitor.log}"

# --- read a key from the `web:` block of the YAML config (no yaml dependency) --------------
read_web() {  # $1 = host|port
  awk -v k="$1" '
    /^[^[:space:]#]/ { inweb = ($0 ~ /^web:/) }
    inweb && $1==k":" { print $2; exit }
  ' "$CONFIG" 2>/dev/null
}
WEB_HOST="$(read_web host)"; WEB_HOST="${WEB_HOST:-127.0.0.1}"
WEB_PORT="$(read_web port)"; WEB_PORT="${WEB_PORT:-8760}"

# --- optional LAN exposure via a throwaway config (never edits the repo config) ------------
if [ -n "${VIGIL_HOST:-}" ]; then
  TMPCFG="$(mktemp "${TMPDIR:-/tmp}/vigil-config.XXXXXX.yaml")"
  awk -v h="$VIGIL_HOST" '
    /^[^[:space:]#]/ { inweb = ($0 ~ /^web:/) }
    inweb && /^[[:space:]]*host:/ { sub(/host:[[:space:]]*.*/, "host: " h) }
    { print }
  ' "$CONFIG" > "$TMPCFG"
  CONFIG="$TMPCFG"; WEB_HOST="$VIGIL_HOST"
fi

lan_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null \
    | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' \
    || hostname -I 2>/dev/null | awk '{print $1}'
}

announce() {
  local ip; ip="$(lan_ip)"
  echo
  echo "  ┌─ Tepna Vigil monitor ─────────────────────────────────────────"
  echo "  │  bound to  ${WEB_HOST}:${WEB_PORT}"
  echo "  │  point your browser to:"
  case "$WEB_HOST" in
    0.0.0.0|"")
      echo "  │    • http://127.0.0.1:${WEB_PORT}/           (this machine)"
      [ -n "$ip" ] && echo "  │    • http://${ip}:${WEB_PORT}/   (phone / other LAN devices)"
      ;;
    127.0.0.1|localhost)
      echo "  │    • http://127.0.0.1:${WEB_PORT}/           (this machine only)"
      echo "  │    to reach it from a phone/other device on the LAN, run:"
      echo "  │        VIGIL_HOST=0.0.0.0 $0 restart"
      [ -n "$ip" ] && echo "  │    …then it'll be at  http://${ip}:${WEB_PORT}/"
      ;;
    *)
      echo "  │    • http://${WEB_HOST}:${WEB_PORT}/"
      ;;
  esac
  echo "  └───────────────────────────────────────────────────────────────"
  echo
}

# --- is THIS pid our capture.py? ------------------------------------------------------------------
# A pid alone is not identity. A pidfile outlives the process it names, and Linux RECYCLES pids — so a
# bare `kill -0 $p` says only "some process exists", and `stop` acting on that can signal a stranger that
# happened to inherit the number. Every decision below is therefore made against the process's own
# /proc entry: it must be running capture.py, out of our capture-host directory.
is_vigil() {  # $1 = pid
  local p="$1" args cwd
  [ -n "$p" ] && [ -r "/proc/$p/cmdline" ] || return 1
  args="$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)" || return 1
  case "$args" in *capture.py*) ;; *) return 1 ;; esac
  # Pin to OUR checkout, not just any capture.py on the box. The cwd (not the config path) is the right
  # discriminator: `VIGIL_HOST=… start` runs the daemon off a throwaway temp config, so a later stop that
  # matched on $CONFIG would fail to recognise the very process it just launched.
  cwd="$(readlink -f "/proc/$p/cwd" 2>/dev/null)"
  [ -z "$cwd" ] || [ "$cwd" = "$(readlink -f "$VIGIL_DIR")" ] || return 1
  return 0
}

running() {  # echo PID if our daemon is alive, else return 1
  local p
  p="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$p" ] && is_vigil "$p"; then echo "$p"; return 0; fi
  # No usable pidfile — but "no pidfile" is NOT "not running", and treating it as such is how a live
  # capture gets declared dead (observed 2026-07-23: `restart` refused to restart a daemon that had been
  # streaming for hours). Recover the real pid from the process table and heal the pidfile.
  for p in $(pgrep -u "$(id -u)" -f capture.py 2>/dev/null); do
    [ "$p" = "$$" ] && continue
    if is_vigil "$p"; then
      echo "$p" >"$PIDFILE" 2>/dev/null || true
      echo "$p"; return 0
    fi
  done
  return 1
}

start() {
  if p="$(running)"; then echo "Vigil is already running (PID $p)."; announce; return 0; fi
  [ -f "$VIGIL_DIR/capture.py" ] || { echo "ERROR: capture.py not found in '$VIGIL_DIR' — set VIGIL_DIR."; return 1; }
  [ -f "$CONFIG" ]               || { echo "ERROR: config not found: '$CONFIG'."; return 1; }
  echo "Starting Vigil monitor …  ($PY capture.py --config $CONFIG)"
  # TWO separate traps live in this one line — both were live bugs, both cost a night.
  #
  # 1. `setsid --fork` (NOT `( … & )`). Parentheses are a FOREGROUND compound: the script waits for the
  #    subshell, and bash is free to optimise the subshell's trailing `cmd &` into an exec — so the
  #    subshell BECOMES the daemon and the wait never ends. That is why `./vigil.sh start` sat there for
  #    7 minutes with capture.py as its child (wchan=do_wait), and why piping it to anything hung: the
  #    daemon held the script's stdout. --fork always forks and the parent exits at once, so the daemon is
  #    reparented to init and nothing upstream waits on it.
  # 2. The daemon RECORDS ITS OWN PID. `& echo $!` cannot: setsid forks to become a session leader, so $!
  #    is a wrapper that dies in milliseconds, leaving the pidfile naming a corpse (and later, after pid
  #    reuse, a stranger). The inner sh writes ITS pid and then `exec`s python over itself — exec keeps the
  #    pid, so the number in the file is the daemon's, fork or no fork.
  #
  # </dev/null so the daemon never holds the caller's stdin.
  # shellcheck disable=SC2016  # The single quotes are the POINT, per (2) above: $$/$1/$2/$3 must be
  # expanded by the INNER `sh -c`, not by this shell. Double quotes would substitute our own pid and
  # our own positional args at build time, so the pidfile would name the wrapper — the exact corpse-pid
  # bug this construction exists to fix. The values are passed as `_ "$PIDFILE" "$PY" "$CONFIG"`.
  ( cd "$VIGIL_DIR" && setsid --fork sh -c 'echo $$ >"$1"; exec "$2" capture.py --config "$3"' \
      _ "$PIDFILE" "$PY" "$CONFIG" >"$LOGFILE" 2>&1 </dev/null )
  # wait (≤15s) for the web port to come up
  for _ in $(seq 1 30); do
    if ss -ltn 2>/dev/null | grep -q ":${WEB_PORT} " \
       || curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:${WEB_PORT}/" 2>/dev/null; then
      echo "Vigil is up (PID $(running || echo '?'))."
      announce
      echo "  logs: $LOGFILE   (tail -f to watch capture)"
      return 0
    fi
    if ! running >/dev/null; then
      echo "ERROR: Vigil exited during startup. Last log lines:"; tail -n 25 "$LOGFILE" 2>/dev/null
      rm -f "$PIDFILE"; return 1
    fi
    sleep 0.5
  done
  echo "NOTE: process started (PID $(running || echo '?')) but port ${WEB_PORT} isn't listening yet."
  echo "      watch it come up with:  tail -f $LOGFILE"
  announce
  return 0
}

# Returns 0 whether or not it was running, and NEVER exits the script — `restart` calls it first, and the
# old `exit 0` on the not-running path killed the whole script before start() ever ran, so `restart` on a
# stopped (or merely unrecognised) Vigil silently did nothing at all.
stop() {
  local p
  if ! p="$(running)"; then echo "Vigil is not running."; rm -f "$PIDFILE"; return 0; fi
  echo "Stopping Vigil (PID $p) …"
  kill "$p" 2>/dev/null || true
  # Re-check identity each poll, not just liveness: if the pid dies and is recycled mid-wait, `kill -0`
  # would keep saying "alive" and we would escalate SIGKILL onto whatever now owns the number.
  for _ in $(seq 1 20); do is_vigil "$p" || break; sleep 0.5; done
  if is_vigil "$p"; then echo "  …still alive, sending SIGKILL"; kill -9 "$p" 2>/dev/null || true; fi
  rm -f "$PIDFILE"
  echo "Vigil stopped."
  return 0
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  if p="$(running)"; then echo "Vigil is RUNNING (PID $p)."; announce; else echo "Vigil is not running."; exit 3; fi ;;
  url)     announce ;;
  *) echo "usage: $0 {start|stop|restart|status|url}   (LAN: VIGIL_HOST=0.0.0.0 $0 start)"; exit 2 ;;
esac
