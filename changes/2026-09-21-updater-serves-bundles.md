---
bump: patch
type: fixed
brief: none
---

tepna-update.sh runs sync-apps.sh and check-system-files.sh whenever they exist (-f), not only when executable (-x): both are committed 0644 and run through bash, so the serve-bundles half of every automatic deploy had been skipped silently (29 of 34 served bundles stale on the box) and /etc drift never reported. Two plant tests at the real mode 0644.
