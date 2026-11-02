---
bump: patch
type: fixed
brief: none
---

Carry each radio anchor's own host receive stamp into the sidecar's `vs_rx_ns` column. The collector already read that stamp for its offset median and wrote a blank cell beside it.
