---
bump: minor
type: added
brief: none
---

Track the rig Ollama router and its watcher in `tools/`, with a selftest wrapper in the tool gate. The router now sends one-input bge-m3 embeds to LAN embed boxes in turn before the GPU. The watcher restarts a hung GPU backend and reports a dead box. Three tools now call `127.0.0.1` instead of `localhost`, which saves about 200 ms of connect time per call on the rig.

After Finch's review (board #7879), the router skips a sick box and counts a 404 or 5xx from a box as a failure. It buffers the box answer before it replies. The watcher restarts a hung backend after two strikes, at most once in 30 minutes, and never while a request is in flight. Once an hour it compares box vectors with a GPU backend and posts a mismatch below cosine 0.999. `tools/remote-gate.sh` runs the capture-host gate in a container on another box. Its result is advisory until it agrees with the rig for a week.
