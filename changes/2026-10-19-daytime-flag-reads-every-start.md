---
bump: patch
type: fixed
brief: none
---

The nights page on capture-host flagged every row as "daytime, not judged" and hid the stored solid-night verdicts. The flag read only the first session start of a recording. On vigil the daemon writes a session file every hour, so each recording chained from an afternoon start into the night. The flag now marks a recording as daytime only when every session in it starts inside the daytime window. A read-only run on vigil's own captures gives `daytime` false for the nine newest rows, so their verdicts show again.
