<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Serve /monitor and /api off the bare IP so the monitor is reachable from a phone — and drop the duplicate log directive that took Caddy down.

`vigil.local` is published by avahi over mDNS, and ANDROID CHROME DOES NOT RESOLVE mDNS: it returns
DNS_PROBE_FINISHED_NXDOMAIN while a Linux box with nss-mdns resolves the identical URL. Caddy's
catch-all redirected every other Host to the pinned name, so the monitor was unreachable from a phone
by any URL at all. The box was never at fault; the resolver was.

The catch-all now serves /monitor and /api and still redirects the app root. The single-origin pin
exists because localStorage/IndexedDB are per-origin, so a second origin means a second longitudinal
history FOR THE DEX APPS — the monitor holds no such state, it renders live data from /api. Patched in
`deploy/expose-monitor.sh`, which install-services.sh calls "the ONE tool that owns it"; editing only
/etc/caddy/Caddyfile would have been undone the next time it ran.

Not an IP site block: eno1 is DHCP, so a hardcoded address breaks on a lease change. The catch-all
matches any address or name.

⚠️ NO `log` DIRECTIVE IN THE CATCH-ALL, AND THAT IS THE POINT. /var/log/tepna is owned vigil:vigil
while caddy runs as caddy:caddy, so that path has NEVER been writable and web.log does not exist. The
pinned site TOLERATES it — a periodic "write error", still serving. My first attempt copied the log
block along with the rest, and a second failing writer did not tolerate: Caddy panicked with
"context: internal error: missing cancel error" and the reload took the whole server down. One
tolerated failure is not evidence that two are safe.

`caddy validate` PASSED on that broken config. It checks syntax, not whether the process can open the
file at runtime — a validated config is not a config that runs.

Verified: the generator's f-string template rendered (104 lines), Caddy validated the OUTPUT rather
than the script, 1 log directive not 2, and the live box now answers /monitor 200 and / 301.

SEPARATE, NOT FIXED HERE: the tracked `capture-host/Caddyfile` has drifted 123 lines from the box —
it still says `tepna.local` and has no monitor proxy, no captures mount, no SSE carve-out. Nothing
installs it and nothing gates it, so it is a stale artifact that reads like configuration. And the
access log has never been written on any box. Both deserve their own change.
