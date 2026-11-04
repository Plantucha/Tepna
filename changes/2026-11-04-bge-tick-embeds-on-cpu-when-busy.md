---
bump: patch
type: fixed
brief: none
---

The hourly doc-search index tick no longer skips while another job holds the GPU. It embeds on the CPU at the lowest priority instead. A session's own search also moves bge to the CPU when the card has less than 4 GB free.
