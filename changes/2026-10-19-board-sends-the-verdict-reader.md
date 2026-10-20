---
bump: patch
type: fixed
brief: none
---
The fleet board reads the solid-night verdicts again. `tools/board.mjs` now sends its verdict reader to the capture box over ssh stdin. The box's reboot on 2026-10-18 wiped the old copy in its `/tmp`, and every board pass after that read "solid-night read failed".
