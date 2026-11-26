---
bump: patch
type: fixed
brief: none
---

The Ollama router sends an embed to a backend whose copy sits wholly in VRAM, and it drops a caller's `num_gpu: 0` request when such a copy serves it. It also unloads a copy that is not in VRAM before an option-less embed, so a CPU runner no longer stays loaded for every later caller.
