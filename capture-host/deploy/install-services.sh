#!/usr/bin/env bash
# tepna-capture — deploy/install-services.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Installs BOTH services as root:  sudo bash install-services.sh
#   tepna-capture — the BLE capture daemon (systemd-managed, survives reboot)
#   tepna-web     — Caddy serving the bundled Dex apps at ONE pinned origin
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo: sudo bash $0"; exit 1; }
OWNER=vigil
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/5  capture unit"
# SOURCE OF TRUTH: the repo's deploy/ copy, NOT $HOME. Until 2026-07-26 this line installed
# /home/vigil/tepna-capture.service — a hand-edited file outside version control that nothing kept in
# step with the repo. By the time it was noticed it was a day stale and differed from what was running,
# so a deploy would have SILENTLY REVERTED that day's CAP_NET_ADMIN grant and re-disarmed the
# watchdog's recovery ladder — a fix undone by the tool meant to ship it, with every gate still green.
UNIT_SRC="$(cd "$(dirname "$0")" && pwd)/tepna-capture.service"
[ -f "$UNIT_SRC" ] || { echo "  ✗ unit source missing: $UNIT_SRC"; exit 1; }
install -m644 "$UNIT_SRC" /etc/systemd/system/tepna-capture.service
systemctl daemon-reload
systemctl enable --now tepna-capture
sleep 5
if systemctl is-active tepna-capture >/dev/null; then
  echo "  ✓ active"
else
  echo "  ✗ NOT active:"; journalctl -u tepna-capture -n 15 --no-pager | sed 's/^/    /'
fi

say "1b/5  unattended deploy completion (VIGIL-AUTO-UPDATE)"
# Installed from the repo for the same reason as the capture unit above — a hand-placed copy is a file
# nothing keeps in step. The updater it schedules runs UNPRIVILEGED as vigil and cannot write /etc; the
# one privileged thing it does goes through the existing tepna-restart.sh grant. See tepna-update.sh.
UPD_SRC="$(cd "$(dirname "$0")/.." && pwd)/systemd"
if [ -f "$UPD_SRC/tepna-update.service" ] && [ -f "$UPD_SRC/tepna-update.timer" ]; then
  install -m644 "$UPD_SRC/tepna-update.service" /etc/systemd/system/tepna-update.service
  install -m644 "$UPD_SRC/tepna-update.timer"   /etc/systemd/system/tepna-update.timer
  systemctl daemon-reload
  # `enable --now` the TIMER, never the service: the service is oneshot, so starting it here would run a
  # deploy in the middle of an install.
  systemctl enable --now tepna-update.timer >/dev/null 2>&1 \
    && echo "  ✓ tepna-update.timer $(systemctl is-active tepna-update.timer)" \
    || echo "  ✗ tepna-update.timer failed to enable"
else
  echo "  ✗ updater units missing under $UPD_SRC"
fi

say "1c/5  nightly BLE air audit (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT D3)"
# Same shape as the updater: an unprivileged oneshot on a timer, installed from the repo. It needs the
# nRF Sniffer on the bus and the extcap under the vigil user's ~/.config/wireshark/extcap — neither
# is installed here; on a box without them the unit FAILS visibly (exit 5/6), which is the point.
if [ -f "$UPD_SRC/tepna-sniff.service" ] && [ -f "$UPD_SRC/tepna-sniff.timer" ]; then
  install -m644 "$UPD_SRC/tepna-sniff.service" /etc/systemd/system/tepna-sniff.service
  install -m644 "$UPD_SRC/tepna-sniff.timer"   /etc/systemd/system/tepna-sniff.timer
  systemctl daemon-reload
  systemctl enable --now tepna-sniff.timer >/dev/null 2>&1 \
    && echo "  ✓ tepna-sniff.timer $(systemctl is-active tepna-sniff.timer)" \
    || echo "  ✗ tepna-sniff.timer failed to enable"
else
  echo "  ✗ sniff units missing under $UPD_SRC"
fi

say "2/5  mDNS so the origin is a NAME, not an IP"
# PIN ONE ORIGIN. localStorage is per-origin, so http://vigil.local, http://localhost and
# http://192.168.0.61 are THREE different profiles + longitudinal histories. A DHCP lease change would
# silently orphan every stored night if the IP were the pin; a .local name survives it.
apt-get install -y -qq avahi-daemon >/dev/null 2>&1 && echo "  ✓ avahi-daemon" || echo "  ✗ avahi install failed"
systemctl enable --now avahi-daemon >/dev/null 2>&1 || true

say "3/5  web server"
# ── THE WEB CONFIG HAS ONE SOURCE, AND IT IS NOT THIS FILE ────────────────────────────────────────
# This step used to write its own /etc/caddy/Caddyfile. It had drifted badly from the one
# expose-monitor.sh writes — no /monitor route, no /captures route, and a bare `encode gzip` with no
# match block. Re-running install-services.sh on a working box would therefore have DELETED the
# monitor and restored the exact gzip stall that froze the live waveform for a day (the encoder
# buffers until a deflate block fills; an SSE stream never ends, so /api/stream/ecg delivered 0
# frames in 30 s to any browser). Two files owning one config is how that happens, so this one no
# longer owns it: it installs Caddy and hands over.
if apt-get install -y -qq caddy >/dev/null 2>&1; then
  echo "  ✓ caddy from apt"
  install -d -o $OWNER -g $OWNER /var/log/tepna
  if [ -s /etc/caddy/Caddyfile ] && grep -q "handle_path /monitor" /etc/caddy/Caddyfile; then
    echo "  ✓ existing Caddyfile already serves /monitor — left untouched"
  else
    echo "  ⚠ no Tepna Caddyfile yet. Run the ONE tool that owns it:"
    echo "        sudo bash $(dirname "$0")/expose-monitor.sh"
    echo "    (it composes, VALIDATES, then installs — and prints a live SSE frame count)"
  fi
  systemctl enable --now caddy >/dev/null 2>&1 || true
  systemctl is-active caddy >/dev/null && echo "  ✓ caddy active" || echo "  ✗ caddy not active"
else
  echo "  ✗ caddy not in apt — install it, then run expose-monitor.sh"
fi

say "3b/5  serve the CURRENT bundles"
# /srv/tepna/app is a COPY of the repo's bundled apps, and nothing was refreshing it. It was
# populated by hand once and then silently rotted: on 2026-07-26 the served PpgDex.html was a full
# day behind the repo, and 11 bundles had never been copied at all. A stale bundle is the worst kind
# of wrong — the phone loads an app that looks right and carries last week's DSP.
bash "$(dirname "$0")/sync-apps.sh" || echo "  ✗ bundle sync failed"

say "4/5  firewall note"
command -v ufw >/dev/null && ufw status | head -2 | sed 's/^/  /' || echo "  (ufw not installed — nothing blocking)"

say "5/5  result"
echo "  capture : $(systemctl is-active tepna-capture) / $(systemctl is-enabled tepna-capture 2>/dev/null)"
echo "  web     : $(systemctl is-active caddy 2>/dev/null || systemctl is-active tepna-web 2>/dev/null)"
served=(/srv/tepna/app/*.html); [ -e "${served[0]}" ] || served=()
echo "  apps    : ${#served[@]} file(s) in /srv/tepna/app"
echo
echo "  Open  http://vigil.local/   — and ALWAYS use that name, never the IP:"
echo "  browser storage is per-origin, so the IP would be a second, separate history."
