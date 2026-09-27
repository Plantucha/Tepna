---
bump: patch
type: fixed
brief: none
---

A deploy now reaches the browser. After #3117 landed, the box served the new PAT Feasibility and sensor-trio-night, but a browser kept rendering its cached pre-deploy copies. The app root sent no `Cache-Control`, so the browser applied heuristic freshness. The old PAT page then received the ring's `_PPG.txt` from the new monitor click and filed it as the ankle. Two layers now close this. The monitor's night click opens each analyzer under a per-click `?v=` query, so it can never be handed a cached copy; no app reads its query string. `deploy/expose-monitor.sh` gives the app root `Cache-Control: no-cache`, so every page revalidates against file_server's ETag and gets a cheap 304 when unchanged. That header reaches `/etc/caddy` only when the installer is re-run as root.
