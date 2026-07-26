<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Fix the installer's post-install stream check, which could only ever report failure — an SSE stream is cut off deliberately so curl always exits 28, and under `set -o pipefail` the `|| N=0` fallback discarded every real count. It condemned a correctly working config as "0 frames in 9 s". Frame counting moves to the tested `deploy/sse-frames.sh`.
