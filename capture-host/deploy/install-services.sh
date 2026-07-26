#!/usr/bin/env bash
# Installs BOTH services as root:  sudo bash install-services.sh
#   tepna-capture — the BLE capture daemon (systemd-managed, survives reboot)
#   tepna-web     — Caddy serving the bundled Dex apps at ONE pinned origin
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo: sudo bash $0"; exit 1; }
OWNER=vigil
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/5  capture unit"
install -m644 /home/$OWNER/tepna-capture.service /etc/systemd/system/tepna-capture.service
systemctl daemon-reload
systemctl enable --now tepna-capture
sleep 5
systemctl is-active tepna-capture >/dev/null && echo "  ✓ active" || { echo "  ✗ NOT active:"; journalctl -u tepna-capture -n 15 --no-pager | sed 's/^/    /'; }

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
echo "  apps    : $(ls /srv/tepna/app/*.html | wc -l) file(s) in /srv/tepna/app"
echo
echo "  Open  http://vigil.local/   — and ALWAYS use that name, never the IP:"
echo "  browser storage is per-origin, so the IP would be a second, separate history."
