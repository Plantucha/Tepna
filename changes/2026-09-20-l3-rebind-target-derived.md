---
bump: patch
type: fixed
brief: none
---

Derive the adapter watchdog's last recovery rung (USB unbind/bind) from the radio being watched instead of the single static `watchdog.usb_path`, so it can no longer re-enumerate a radio that is neither wedged nor monitored while leaving the wedged one untouched; when nothing is derivable the rung refuses rather than falling back.
