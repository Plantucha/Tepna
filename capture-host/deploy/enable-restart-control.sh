#!/usr/bin/env bash
# tepna-capture — deploy/enable-restart-control.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Let a deploy finish itself — restart the capture daemon WITHOUT an interactive password,
# and without opening a root hole.
#   sudo bash enable-restart-control.sh
#
# WHY. `git pull` only puts new code on disk; the running daemon keeps serving the old build until
# something restarts it, and `vigil` cannot call systemctl. On 2026-07-30 the box therefore sat on
# `63a0703` with the fixes present but not running, because the restart wanted a password nobody was
# awake to type. A capture box that cannot complete its own deploy runs stale code all night.
#
# Deliberately a SEPARATE sudoers file from /etc/sudoers.d/tepna: that one is written whole by
# enable-clock-control.sh, so appending here would be clobbered the next time it runs.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo: sudo bash $0"; exit 1; }
SRC=/opt/tepna/capture-host
DST=/usr/local/lib/tepna          # helper_path.SYSTEM_DIRS[0] — preferred over the in-repo copy
USER_=vigil
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/3  deploy the helper root-owned"
# THE WHOLE POINT, same as enable-clock-control.sh: a NOPASSWD grant must name a file the granted user
# CANNOT rewrite. The in-repo copy is vigil-owned, so granting sudo on it would let anything running as
# vigil — a compromised browser tab, a bad pip install, the unauthenticated web API — replace the script
# and get passwordless root. Root-owned 0755 under /usr/local/lib/tepna is the only safe target.
[ -f "$SRC/tepna-restart.sh" ] || { echo "  ✗ $SRC/tepna-restart.sh missing — pull the repo first"; exit 1; }
install -D -o root -g root -m 0755 "$SRC/tepna-restart.sh" "$DST/tepna-restart.sh"
echo "  ✓ $DST/tepna-restart.sh  $(stat -c'%U:%G %a' "$DST/tepna-restart.sh")"

say "2/3  scoped sudoers grant (validated before install)"
# NOT `NOPASSWD: /usr/bin/systemctl`. That would hand vigil every unit on the box, including the ability
# to mask the services that constrain it. The helper takes a fixed verb and names ONE unit, so the blast
# radius is exactly "restart the capture daemon".
TMP=$(mktemp)
cat > "$TMP" <<RULES
# Tepna Vigil — restart the capture daemon ONLY. Root-owned, non-writable by $USER_.
$USER_ ALL=(root) NOPASSWD: $DST/tepna-restart.sh
RULES
if visudo -cqf "$TMP"; then
  install -o root -g root -m 0440 "$TMP" /etc/sudoers.d/tepna-restart
  echo "  ✓ /etc/sudoers.d/tepna-restart installed and syntax-valid"
else
  echo "  ✗ sudoers syntax INVALID — not installed (nothing changed)"; rm -f "$TMP"; exit 1
fi
rm -f "$TMP"

# NoNewPrivileges must already be off for sudo to work at all from the daemon's own context; that is
# enable-clock-control.sh's doing and is NOT re-applied here. This grant is for the SHELL path (a deploy
# script, an ssh one-liner), which is unaffected by the unit's setting.

say "3/3  verify"
echo "  helper owner  : $(stat -c'%U:%G %a' "$DST/tepna-restart.sh")"
echo "  sudo -n status: $(sudo -u $USER_ sudo -n $DST/tepna-restart.sh status 2>&1 | head -1)"
echo
echo "  a deploy can now finish itself:"
echo "    ssh $USER_@<box> 'cd /opt/tepna && git pull --ff-only && sudo -n $DST/tepna-restart.sh restart'"
