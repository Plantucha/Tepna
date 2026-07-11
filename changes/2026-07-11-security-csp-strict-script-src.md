<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: security
nodes: [suite]
brief: SECURITY-CSP-STRICT-SCRIPT-SRC-2026-07-11-BRIEF.md
---
Drop `'unsafe-inline'` from every bundle's CSP `script-src` in favour of per-block `sha256` hashes computed by the owned bundler, so an injected `<script>` no longer executes (CSP is now an injection backstop, not just the `connect-src 'none'` egress control); all ~167 inline `on*=` handlers are converted to a shared event-delegation dispatcher (`dex-actions.js`, `data-act`) — `style-src` deliberately keeps `'unsafe-inline'` (non-goal).
