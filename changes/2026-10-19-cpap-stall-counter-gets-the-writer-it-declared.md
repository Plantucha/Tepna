---
bump: patch
type: fixed
brief: none
---

Give the CPAP `stalls` counter the detector it cited. The continuity tracker already computes the sample each frame owes, so compare every frame against it. A mid-session break is a spec §30 STREAM_STALL, and the acquisition evidence surface sums a measured one as known loss beside `sink_errors`. `post_drop_tail` stays null: the drop instant it needs never reaches this layer.
