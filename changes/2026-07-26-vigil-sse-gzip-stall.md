<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Stop the reverse proxy compressing the live event stream — a bare `encode gzip` matched `text/event-stream`, and because Caddy's encoder buffers until a deflate block fills while an SSE stream never ends, the bedside monitor's waveform never painted in any browser (0 frames in 30 s to a gzip-capable client, vs 15 in 8 s without). Also brings the box's provisioning scripts into the repo; they existed only in a scratch directory.
