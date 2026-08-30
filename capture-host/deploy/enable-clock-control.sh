#!/usr/bin/env bash
# tepna-capture — deploy/enable-clock-control.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Option B — let the monitor set the clock/NTP again, WITHOUT opening a root hole.
#   sudo bash enable-clock-control.sh
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo: sudo bash $0"; exit 1; }
SRC=/opt/tepna/capture-host
DST=/usr/local/lib/tepna          # helper_path.SYSTEM_DIRS[0] — checked BEFORE the in-repo copy
USER_=vigil
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/4  deploy the helpers root-owned"
# THE WHOLE POINT. A NOPASSWD grant must name a file the granted user CANNOT rewrite. The in-repo copy is
# vigil-owned and group-writable, so granting sudo on it would let anything running as vigil — a
# compromised browser tab, a bad pip package, the unauthenticated web API — overwrite the script and get
# instant passwordless root. Root-owned 0755 under /usr/local/lib/tepna is the only safe target, and
# helper_path.resolve() prefers it automatically.
for h in tepna-clock.sh tepna-rssi.sh tepna-btreset.sh tepna-wifi.sh; do
  [ -f "$SRC/$h" ] || { echo "  skip $h (not in repo)"; continue; }
  install -D -o root -g root -m 0755 "$SRC/$h" "$DST/$h"
  echo "  ✓ $DST/$h  $(stat -c'%U:%G %a' "$DST/$h")"
done

say "2/4  scoped sudoers grant (validated before install)"
TMP=$(mktemp)
cat > "$TMP" <<RULES
# Tepna Vigil — the monitor's clock/NTP + RSSI helpers, and the watchdog's last recovery rung. ONLY
# these. Root-owned, non-writable by $USER_.
$USER_ ALL=(root) NOPASSWD: $DST/tepna-clock.sh
$USER_ ALL=(root) NOPASSWD: $DST/tepna-rssi.sh
$USER_ ALL=(root) NOPASSWD: $DST/tepna-btreset.sh
# The Wi-Fi UPLINK helper (scan/join/leave/status). Listed explicitly rather than relying on a
# wildcard, because THIS FILE REWRITES THE WHOLE GRANT: anything not named here is removed the
# next time this script runs, and a helper that works until someone re-runs the installer is
# worse than one that never worked.
$USER_ ALL=(root) NOPASSWD: $DST/tepna-wifi.sh
RULES
if visudo -cqf "$TMP"; then
  install -o root -g root -m 0440 "$TMP" /etc/sudoers.d/tepna
  echo "  ✓ /etc/sudoers.d/tepna installed and syntax-valid"
else
  echo "  ✗ sudoers syntax INVALID — not installed (nothing changed)"; rm -f "$TMP"; exit 1
fi
rm -f "$TMP"

say "3/4  allow the daemon to escalate to those two helpers"
# NoNewPrivileges=yes makes sudo structurally impossible, so it has to go for the clock buttons to work.
# Everything else stays: ProtectSystem=strict, ProtectHome, the ReadWritePaths allowlist. The blast
# radius is now exactly the two root-owned scripts named above, not "root".
mkdir -p /etc/systemd/system/tepna-capture.service.d
cat > /etc/systemd/system/tepna-capture.service.d/clock-control.conf <<'DROPIN'
[Service]
# Option B (2026-07-25): the monitor's Save&apply / Sync now / Set timezone call tepna-clock.sh under
# sudo, which NoNewPrivileges forbids outright. Relaxed here rather than in the unit so re-running
# install-services.sh cannot silently revert it. Paired with /etc/sudoers.d/tepna, which scopes the
# grant to two root-owned, non-user-writable helpers.
NoNewPrivileges=no
# ⚠️ AND THE THREE PATHS THE UNIT FILE SAID WERE HERE AND WERE NOT (found 2026-08-30).
# tepna-capture.service's own comment describes this drop-in as containing exactly this line, and
# explains why: ProtectSystem=strict mounts the whole hierarchy read-only and sudo'd children inherit
# it, so /etc/chrony blocks writing the servers and /run/chrony blocks chronyc from creating the reply
# socket it needs to talk to chronyd AT ALL. Only NoNewPrivileges was ever written, so Sync now failed
# with "chronyc could not be reached — is chronyd running?" on a box where chronyd was running fine and
# NTPSynchronized was already yes. The prose was right; the script did not implement it.
# The `-` prefix makes each path optional, so a box without chrony still starts.
ReadWritePaths=-/etc/chrony -/etc/systemd/timesyncd.conf.d -/run/chrony
DROPIN
systemctl daemon-reload
systemctl restart tepna-capture
sleep 5

say "4/4  verify"
echo "  unit           : $(systemctl is-active tepna-capture) / NoNewPrivileges=$(systemctl show tepna-capture -p NoNewPrivileges --value)"
echo "  helper resolved: $(sudo -u $USER_ $SRC/.venv/bin/python -c "import sys;sys.path.insert(0,'$SRC');import helper_path as h;p=h.resolve('tepna-clock.sh');print(p,'| safely-owned:',h.is_safely_owned(p))" 2>/dev/null)"
# shellcheck disable=SC2016  # the backticks are PROSE — Markdown-style emphasis inside a message we
# print, not a command substitution we forgot to escape. Single quotes are exactly right here.
echo "  sudo -n works  : $(sudo -u $USER_ sudo -n $DST/tepna-clock.sh status >/dev/null 2>&1 && echo yes || echo 'no (check the helper accepts `status`)')"
code=$(curl -s -o /tmp/cs.json -w '%{http_code}' --max-time 20 -X POST http://127.0.0.1:8760/api/clock/sync)
echo "  POST /api/clock/sync -> HTTP $code"
echo "  response: $(head -c 200 /tmp/cs.json)"
