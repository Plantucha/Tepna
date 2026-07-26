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
if apt-get install -y -qq caddy >/dev/null 2>&1; then
  echo "  ✓ caddy from apt"
  install -d -o $OWNER -g $OWNER /var/log/tepna
  cat > /etc/caddy/Caddyfile <<'CADDY'
# Tepna web — the bundled Dex apps at ONE pinned origin (see capture-host/Caddyfile for the rationale).
# Plain HTTP is correct here: no Tepna feature needs a secure context, and the apps make ZERO external
# requests. Serving them on the LAN is not the same as the app phoning out.
http://vigil.local, http://vigil {
	root * /srv/tepna/app
	file_server browse
	encode gzip
	log {
		output file /var/log/tepna/web.log
	}
}
CADDY
  systemctl enable --now caddy && systemctl reload caddy 2>/dev/null || systemctl restart caddy
  systemctl is-active caddy >/dev/null && echo "  ✓ caddy active" || echo "  ✗ caddy not active"
else
  echo "  ✗ caddy not in apt — falling back to a minimal static server unit"
  cat > /etc/systemd/system/tepna-web.service <<'WEB'
[Unit]
Description=Tepna web (static Dex apps)
After=network-online.target
[Service]
User=vigil
WorkingDirectory=/srv/tepna/app
ExecStart=/usr/bin/python3 -m http.server 80 --bind 0.0.0.0
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
WEB
  systemctl daemon-reload && systemctl enable --now tepna-web
fi

say "4/5  firewall note"
command -v ufw >/dev/null && ufw status | head -2 | sed 's/^/  /' || echo "  (ufw not installed — nothing blocking)"

say "5/5  result"
echo "  capture : $(systemctl is-active tepna-capture) / $(systemctl is-enabled tepna-capture 2>/dev/null)"
echo "  web     : $(systemctl is-active caddy 2>/dev/null || systemctl is-active tepna-web 2>/dev/null)"
echo "  apps    : $(ls /srv/tepna/app/*.html | wc -l) file(s) in /srv/tepna/app"
echo
echo "  Open  http://vigil.local/   — and ALWAYS use that name, never the IP:"
echo "  browser storage is per-origin, so the IP would be a second, separate history."
