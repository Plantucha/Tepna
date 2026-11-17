---
bump: patch
type: fixed
brief: none
---

PPGDex no longer publishes 176 Hz for a sample rate that it did not measure. `parsePPG` started from 176 and used the device deltas only when more than 20 existed. A short 125 Hz file therefore published 176 Hz and a duration 41 % too short. Now one device delta sets the rate. The concentration share keeps its 20-delta floor.

A stream with no device delta and no readable clock now refuses with `no-sample-rate`. The analysis also publishes `channel: null` with `channelReason` when `pickChannel` scored no channel, in place of "ch0 (best SNR)". Shrike found the sites and wrote the patch. Kestrel verified it and fixed the table row in `ppgdex-app.js`.
