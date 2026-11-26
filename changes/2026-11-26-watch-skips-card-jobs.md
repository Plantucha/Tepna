---
bump: patch
type: fixed
brief: none
---

The router watchdog `tools/ollama-router-watch.sh` now skips its two direct backend embeds while a `gpu-run.sh` job holds the card. Check (a) probes each backend for a hang. Check (c) compares the embed box vectors with a GPU backend. Each of them could load a second bge-m3 copy with `keep_alive` 30m beside a capped card job. On 2026-11-26 at 07:15:18 such a probe loaded bge-m3 on Vulkan, 24 s before a ROCm fault.

The watchdog reads the PID files in the wrapper's runtime folder and never prunes them. The router-level embed still runs, because every interactive query takes that path. After a card job ends, the next watchdog run probes the backends again.
