---
bump: patch
type: fixed
brief: none
---

The Ollama router sends an embed to a backend whose copy sits wholly in VRAM. When such a copy serves the request, the router drops the caller's `num_gpu: 0` ask. Before an option-less embed, it unloads a copy that is not in VRAM. A CPU runner then no longer stays loaded for every later caller.
