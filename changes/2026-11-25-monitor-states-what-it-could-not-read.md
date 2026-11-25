---
bump: patch
type: fixed
brief: none
---

The monitor states what it could not read. A page whose poll fails, or never returns for 15 s, says "No answer from the box" with the time of the last state. A battery level from a device that is not connected names the hour it was read. A night index that did not load says so and retries, where it read "no nights on disk". A CPAP state the page does not know is a warning that names it, where it read "idle · next run 13:00". The battery history skips the level that a disconnected device repeats: on the box, 19,528 of 64,970 rows in seven nights.
