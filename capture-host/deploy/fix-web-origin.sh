#!/usr/bin/env bash
# The IP answered 200-with-an-empty-body (Caddy's default for an unmatched Host), which is
# indistinguishable from "server down". Redirect it to the pinned name instead of serving a blank page.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo: sudo bash $0"; exit 1; }
cat > /etc/caddy/Caddyfile <<'CADDY'
# Tepna web — the bundled Dex apps at ONE pinned origin.
#
# PIN ONE ORIGIN. localStorage/IndexedDB are per-origin, so http://vigil.local, http://localhost and
# http://192.168.0.61 are THREE separate profiles and THREE separate longitudinal histories. Reaching
# the box by IP one day and by name the next silently splits a subject's night history in half — and a
# DHCP lease change would orphan the IP-keyed half permanently.
http://vigil.local, http://vigil {
	root * /srv/tepna/app
	file_server browse
	encode gzip
	log {
		output file /var/log/tepna/web.log
	}
}

# Anything else that reaches port 80 — the bare IP, localhost, an old bookmark — is REDIRECTED to the
# pinned name rather than served. Serving it would quietly create a second history; answering with
# Caddy's empty default (the previous behaviour) looked identical to the server being down.
:80 {
	redir http://vigil.local{uri} permanent
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  && echo "  ✓ Caddyfile valid" || { echo "  ✗ INVALID — not reloading"; exit 1; }
systemctl reload caddy || systemctl restart caddy
sleep 2
echo "  caddy: $(systemctl is-active caddy)"
echo "  by name: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 6 -H 'Host: vigil.local' http://127.0.0.1/)"
echo "  by IP  : HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 6 http://192.168.0.61/) (301 = redirected to the pinned name)"
