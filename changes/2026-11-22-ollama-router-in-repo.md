---
bump: minor
type: added
brief: none
---

Track the rig Ollama router and its watcher in `tools/`, with a selftest wrapper in the tool gate. The router now sends one-input bge-m3 embeds to LAN embed boxes in turn before the GPU. The watcher restarts a hung GPU backend and reports a dead box. Three tools now call `127.0.0.1` instead of `localhost`, which saves about 200 ms of connect time per call on the rig.
