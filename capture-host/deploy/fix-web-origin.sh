#!/usr/bin/env bash
# tepna-capture — deploy/fix-web-origin.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# The IP answered 200-with-an-empty-body (Caddy's default for an unmatched Host), which is
# indistinguishable from "server down". Redirect it to the pinned name instead of serving a blank page.
#
# WRITES ATOMICALLY: composes to a temp file, validates THAT, and only then replaces the live config.
# It used to overwrite /etc/caddy/Caddyfile FIRST and validate after — so a syntax error left the box
# holding a config it could not reload, while the script printed "not reloading" and reverted nothing.
# That is the identical bug expose-monitor.sh's header records having fixed; this script kept it until
# 2026-08-01. A failed validation must change nothing.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo: sudo bash $0"; exit 1; }
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<'CADDY'
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
if caddy validate --config "$TMP" --adapter caddyfile >/dev/null 2>&1; then
  install -o root -g root -m 0644 "$TMP" /etc/caddy/Caddyfile
  echo "  ✓ Caddyfile valid — installed"
else
  echo "  ✗ INVALID — not installed (nothing changed)"; exit 1
fi
systemctl reload caddy || systemctl restart caddy
sleep 2
echo "  caddy: $(systemctl is-active caddy)"
echo "  by name: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 6 -H 'Host: vigil.local' http://127.0.0.1/)"
echo "  by IP  : HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 6 http://192.168.0.61/) (301 = redirected to the pinned name)"
