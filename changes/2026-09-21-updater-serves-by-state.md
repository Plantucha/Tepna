---
bump: patch
type: fixed
brief: none
---

tepna-update.sh syncs the served bundles whenever sync-apps.sh --check reports drift, on every tick — not only when this run fast-forwarded the checkout. tepna-sync-main also fast-forwards it, and when it won the hour the tick read nothing-to-do while 30 of 35 served bundles stayed stale.
