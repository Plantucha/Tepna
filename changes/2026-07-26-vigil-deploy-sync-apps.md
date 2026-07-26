<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Sync the served bundles on every deploy, and stop install-services.sh owning the web config. `/srv/tepna/app` is a copy of the repo's bundles that nothing refreshed — on 2026-07-26 the served PpgDex.html was a full day behind and eleven bundles had never been copied, so the phone loaded apps that opened and computed with old DSP while every provenance gate stayed green on the repo copy. `sync-apps.sh` closes that with a `--check` that exits non-zero, and never deletes files it does not own. Separately, install-services.sh wrote its own Caddyfile that had drifted to no /monitor route, no /captures and a bare `encode gzip` — re-running it would have deleted the monitor and restored the SSE gzip stall.
