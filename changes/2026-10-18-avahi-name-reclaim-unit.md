---
bump: patch
type: fixed
brief: none
---

Reclaim the mDNS name when avahi renamed the box.
A `tepna-avahi-name` oneshot asks avahi which name it advertises, and restarts avahi on a mismatch.
The capture unit wants that unit and never orders itself after it, so a slow restart costs no capture.

