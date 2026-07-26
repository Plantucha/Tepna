#!/usr/bin/env bash
# Put apps + monitor + captures on the LAN at one origin, behind browser-native auth.
#   sudo bash expose-monitor.sh
#
# WRITES ATOMICALLY: composes to a temp file, validates THAT, and only then replaces the live config.
# The previous version overwrote /etc/caddy/Caddyfile first and validated after — so a syntax error left
# the box with a broken config it could not reload, while printing "reverting" and reverting nothing.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo: sudo bash $0"; exit 1; }

# Caddy renamed `basicauth` -> `basic_auth` in 2.8. Pick by version rather than assuming.
VER="$(caddy version 2>/dev/null | awk '{print $1}' | tr -d v)"
MAJ="${VER%%.*}"; REST="${VER#*.}"; MIN="${REST%%.*}"
if [ "${MAJ:-2}" -gt 2 ] || { [ "${MAJ:-2}" -eq 2 ] && [ "${MIN:-0}" -ge 8 ]; }; then
  AUTHDIR=basic_auth; else AUTHDIR=basicauth; fi
echo "  caddy $VER -> using '$AUTHDIR'"

echo
echo "The control API (bond/forget/pull/settings/storage/clock) has no auth of its own, and"
echo "monitor.html sends no token — so a token would lock the UI out of its own buttons. Caddy auth"
echo "works because the BROWSER holds the credentials; your phone asks once and remembers."
read -rp "Username [vigil]: " U; U="${U:-vigil}"
read -rsp "Password (empty = NO auth, full LAN control + all health data readable): " P; echo

AUTH=""
if [ -n "$P" ]; then
  H="$(caddy hash-password --plaintext "$P" 2>/dev/null)" || { echo "  ✗ hash-password failed"; exit 1; }
  AUTH="$AUTHDIR { $U $H }"
  echo "  ✓ bcrypt hashed; plaintext stored nowhere"
else
  echo "  ⚠ NO AUTH"
fi

TMP="$(mktemp)"
# Composed by python, NOT a shell heredoc: a bcrypt hash is full of '$' and an unquoted heredoc would
# expand $2a/$14 as shell variables and silently corrupt it.
AUTH="$AUTH" python3 - "$TMP" <<'PY'
import os, sys
auth = os.environ.get("AUTH", "").strip()
auth_block = ("\n\t" + auth.replace(" { ", " {\n\t\t").replace(" }", "\n\t}") + "\n") if auth else ""
open(sys.argv[1], "w").write(f"""# Tepna web — apps, monitor and captures at ONE pinned origin.
#
# PIN ONE ORIGIN. localStorage/IndexedDB are per-origin, so vigil.local, localhost and the bare IP are
# three separate profiles and three separate longitudinal histories. The catch-all below redirects
# anything else rather than serving it, so a stray bookmark cannot start a second history.
http://vigil.local, http://vigil {{{auth_block}
\t# Control API. flush_interval -1 disables buffering — without it the live SSE waveform stream
\t# (/api/stream/_all) sits in Caddy's buffer and the scope never paints.
\thandle /api/* {{
\t\treverse_proxy 127.0.0.1:8760 {{
\t\t\tflush_interval -1
\t\t}}
\t}}
\t# handle_path (not handle) strips the prefix, so webmon still sees "/" and serves monitor.html.
\thandle_path /monitor* {{
\t\treverse_proxy 127.0.0.1:8760 {{
\t\t\tflush_interval -1
\t\t}}
\t}}
\t# The recordings, so a Dex can be pointed at a night from a phone. READ-ONLY by construction:
\t# file_server never writes, and nothing on this path can reach capture.py.
\thandle_path /captures* {{
\t\troot * /srv/tepna/captures
\t\tfile_server browse
\t}}
\thandle {{
\t\troot * /srv/tepna/app
\t\tfile_server browse
\t}}
\t# gzip everything EXCEPT text/event-stream, by naming the text subtypes instead of using text/*.
\t# This is not a nicety. Caddy's encoder buffers until a deflate block fills, and an SSE stream never
\t# ends — so a bare `encode gzip` (whose default match includes text/*) held the live waveform
\t# hostage. Measured on the box 2026-07-26: /api/stream/ecg delivered 0 frames in 30 s to a
\t# gzip-capable client vs 15 in 8 s without gzip, and /api/stream/_all arrived in 26-second clumps —
\t# the "judder" that looked like BLE frame batching. flush_interval -1 above unbuffers the PROXY;
\t# this unbuffers the ENCODER. Both are needed, and fixing only one looks like fixing neither.
\t# text/javascript is listed because Go maps .js to text/javascript, not application/javascript.
\tencode gzip {{
\t\tmatch {{
\t\t\theader Content-Type text/html*
\t\t\theader Content-Type text/css*
\t\t\theader Content-Type text/plain*
\t\t\theader Content-Type text/csv*
\t\t\theader Content-Type text/javascript*
\t\t\theader Content-Type application/json*
\t\t\theader Content-Type application/javascript*
\t\t\theader Content-Type image/svg+xml*
\t\t}}
\t}}
\tlog {{
\t\toutput file /var/log/tepna/web.log
\t}}
}}

# Bare IP / localhost / anything else -> the pinned name, never served directly.
:80 {{
\tredir http://vigil.local{{uri}} permanent
}}
""")
PY

if caddy validate --config "$TMP" --adapter caddyfile >/dev/null 2>&1; then
  cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)" 2>/dev/null || true
  install -o root -g root -m 0644 "$TMP" /etc/caddy/Caddyfile
  rm -f "$TMP"
  echo "  ✓ validated, then installed (previous kept as Caddyfile.bak.*)"
else
  echo "  ✗ generated config is INVALID — live config untouched:"
  caddy validate --config "$TMP" --adapter caddyfile 2>&1 | grep -i error | head -3 | sed 's/^/    /'
  rm -f "$TMP"; exit 1
fi

systemctl reload caddy || systemctl restart caddy
sleep 2
A=""; [ -n "$P" ] && A="-u $U:$P"
echo
echo "  caddy    : $(systemctl is-active caddy)"
for path in "/" "/monitor/" "/api/state" "/captures/"; do
  printf "  %-11s HTTP %s\n" "$path" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 $A -H 'Host: vigil.local' "http://127.0.0.1$path")"
done
[ -n "$P" ] && echo "  unauthed   HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 6 -H 'Host: vigil.local' http://127.0.0.1/api/state)  (401 = auth enforced)"

# PROVE the live stream streams. Every check above passes on a config that returns 200 and then
# delivers nothing for thirty seconds — which is precisely how the gzip stall shipped green. A status
# code is not a stream. --compressed is the point: it makes curl behave like a browser (browsers ALWAYS
# advertise gzip), and the bug was invisible to a plain curl that did not.
echo
echo "  live SSE, as a browser sees it:"
for s in _all ecg; do
  # Counting is delegated to sse-frames.sh, which is tested. Doing it inline here is what produced a
  # permanent false "0 frames": pipefail plus a deliberately timed-out curl makes the pipeline
  # non-zero every run, so an `|| N=0` fallback clobbers the real count. See that script's header.
  N=$(bash "$(dirname "$0")/sse-frames.sh" "http://127.0.0.1/api/stream/$s" 9 $A -H 'Host: vigil.local')
  if [ "${N:-0}" -ge 3 ]; then
    printf "    ✓ /api/stream/%-5s %s frames in 9 s\n" "$s" "$N"
  else
    printf "    ✗ /api/stream/%-5s only %s frames in 9 s — the browser will show a frozen trace.\n" "$s" "${N:-0}"
    echo "      Something between Caddy and the client is buffering; check the 'encode' match block."
  fi
done
