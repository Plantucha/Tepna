---
bump: patch
type: fixed
brief: none
---
`tools/unit-health.mjs` no longer reads a timer whose service runs as stopped. systemd arms the next elapse only when the service exits. So a running timer holds no next elapse for the whole run. The tool now reads the timer's `SubState` and judges `running` alive.
