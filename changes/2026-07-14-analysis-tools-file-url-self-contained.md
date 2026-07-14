<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite, tooling]
brief: LOCAL-DOWNLOAD-FILE-URL-FIX-2026-07-14-BRIEF.md
---
Make the 9 science/analysis tools self-contained single-file HTML so they run from a local download over `file://` (they only worked when served): new `tools/build-analysis.mjs` inlines every external script and rewrites `new Worker('x.js')` → a blob-URL worker with its deps inlined; gated by `build-analysis.mjs --check` in CI plus a Node-suite invariant group (no external `<script src>`, no file-path workers). Verified under file:// and http:// with headless Chromium.
