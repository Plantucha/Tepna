---
bump: patch
type: fixed
brief: none
---

A heartbeat in the H10 HR packet outvotes a skin-contact bit that says not-worn, so the 180 s power drop no longer cuts a dry-electrode strap that is recording a real rate (2026-09-20: 131 drops, 41 % of the ECG kept). A beat can only keep a link, never drop one; charging still outranks it.
