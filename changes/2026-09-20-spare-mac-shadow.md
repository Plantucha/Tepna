---
bump: patch
type: fixed
brief: none
---

Stop `_pick_live_spare` binding two different things to the name `mac` in one scope, which had pushed capture-host's mypy advisory count one above its baseline.
