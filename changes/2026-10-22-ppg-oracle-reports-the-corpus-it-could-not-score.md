---
bump: patch
type: fixed
brief: none
---

Publish a `NOT_RUN` verdict with the night population when `oracle-ppg-device-beats.mjs` finds no ring session file. An absent root and a root holding no `_PPG.txt` then stop reading alike. The verdict's population now counts nights, matching the unit of its own floor, and a run that scored nothing exits 2.
The run also names the directories its read removed.
