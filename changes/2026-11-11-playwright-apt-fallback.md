---
bump: patch
type: fixed
brief: none
---

Install chromium without the OS font packages when apt cannot reach a mirror, so a runner DNS
failure no longer reds both required browser contexts on every PR.
