---
bump: patch
type: fixed
brief: none
---

The Ollama router sends an embed to a backend whose copy sits wholly in VRAM, and it drops a caller's `num_gpu: 0` request when such a copy serves it, so that request no longer reloads the shared GPU runner onto the CPU.
