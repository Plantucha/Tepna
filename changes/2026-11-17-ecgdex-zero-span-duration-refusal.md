---
bump: patch
type: fixed
brief: none
---

ECGDex no longer publishes a span or a duration for a beat series that spans no time. `analyze` replaced a zero span with the last beat's offset and then with 0, and it built a duration from `N * meanRR`. A stuck device counter therefore published `spanMin: 0.1`, `durSec: 5` and the tier "< 2 min". Now `spanSec`, `durSec`, `durMin` and `spanMin` are `null`.

The tier and the mode name the unmeasured duration, and the app prints "an unmeasured duration" in place of "0 min". Shrike found the sites and wrote the DSP patch. Kestrel verified it and followed the null into `ecgdex-app.js`.
